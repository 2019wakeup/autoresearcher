"""AutoResearcher API 服务：任务注册表 + 鉴权 + WebSocket 日志流。

前后端分离架构的后端入口：
- 前端（React 面板）只通过本服务的 REST/WebSocket API 交互
- Agent 核心（DSH headless）以后台子进程方式运行

运行：
    pip install -r requirements.txt
    API_TOKEN=xxx DSH_BIN=dsh python server.py
"""
import asyncio
import json
import os
import secrets
import subprocess
import threading
import time
import uuid
from pathlib import Path

from fastapi import FastAPI, WebSocket, Depends, HTTPException, Header
from pydantic import BaseModel

app = FastAPI(title="AutoResearcher", version="0.1.0")

TASK_DIR = Path("data/tasks")
LOG_DIR = Path("data/logs")
RESULT_DIR = Path("data/results")
for d in (TASK_DIR, LOG_DIR, RESULT_DIR):
    d.mkdir(parents=True, exist_ok=True)

# 生产环境必须注入 API_TOKEN；不注入时生成随机值并打印警告
API_TOKEN = os.environ.get("API_TOKEN") or secrets.token_hex(16)
if "API_TOKEN" not in os.environ:
    print(f"[warn] API_TOKEN 未设置，已生成临时值: {API_TOKEN}（重启会失效）")

DSH_BIN = os.environ.get("DSH_BIN", "dsh")
DSH_PROFILE = os.environ.get("DSH_PROFILE", "headless")
# DRY_RUN=1：不依赖 dsh，用假任务进程测通 API 全链路（CI/本地冒烟用）
DRY_RUN = os.environ.get("DRY_RUN", "0") == "1"

# 内存任务表：taskId -> {status, proc, createdAt}
tasks: dict[str, dict] = {}


def auth(authorization: str | None = Header(default=None)):
    """Bearer token 鉴权：所有 REST 端点强制校验。"""
    if authorization != f"Bearer {API_TOKEN}":
        raise HTTPException(status_code=401, detail="unauthorized")
    return True


def _collect_result(task_id: str, proc: subprocess.Popen, log_path: Path) -> None:
    """进程退出后：从日志中提取最后一个 JSON 块，写入 data/results/{task_id}.json。

    约定：Agent 的任务输出以 JSON 块结尾（如评测报告的 papers 数组），
    提取第一个 { 到最后一个 } 之间的内容。
    """
    proc.wait()
    tasks[task_id]["status"] = "done"
    text = log_path.read_text(errors="ignore")
    start, end = text.find("{"), text.rfind("}")
    if 0 <= start < end:
        try:
            payload = json.loads(text[start : end + 1])
            (RESULT_DIR / f"{task_id}.json").write_text(
                json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
            tasks[task_id]["resultSaved"] = True
        except json.JSONDecodeError:
            tasks[task_id]["resultSaved"] = False
    else:
        tasks[task_id]["resultSaved"] = False


def ws_auth(token: str | None = None) -> bool:
    """WebSocket 鉴权：token 通过查询参数传入（?token=xxx）。"""
    return token == API_TOKEN


class TaskRequest(BaseModel):
    task: str
    profile: str | None = None


@app.get("/api/health", dependencies=[Depends(auth)])
def health():
    return {"ok": True, "dsh": DSH_BIN, "version": "0.1.0", "dryRun": DRY_RUN}


@app.post("/api/tasks", dependencies=[Depends(auth)])
def create_task(req: TaskRequest):
    """创建科研任务：以子进程运行 DSH headless，日志落盘供审计与流式。"""
    if not req.task.strip():
        raise HTTPException(status_code=422, detail="task 不能为空")
    task_id = uuid.uuid4().hex[:8]
    log_path = TASK_DIR / f"{task_id}.log"
    profile = req.profile or DSH_PROFILE
    if DRY_RUN:
        # 假任务：输出几行日志后以 JSON 块结尾（模拟 Agent 产出结构化结果）
        cmd = ["sh", "-c",
               "echo '[dry-run] task started'; sleep 1; "
               "echo '[dry-run] working...'; sleep 1; "
               "echo '{\"dryRun\": true, \"task\": \"" + req.task + "\", \"ok\": true}'"]
    else:
        cmd = [DSH_BIN, "--profile", profile, req.task]
    proc = subprocess.Popen(
        cmd,
        stdout=open(log_path, "w"),
        stderr=subprocess.STDOUT,
    )
    tasks[task_id] = {"status": "running", "proc": proc, "createdAt": time.time()}
    # 后台等待：进程退出后解析结果 JSON（若输出含 JSON 块）并落盘
    threading.Thread(
        target=_collect_result, args=(task_id, proc, log_path), daemon=True,
    ).start()
    return {"taskId": task_id, "status": "running", "profile": profile}


@app.get("/api/tasks", dependencies=[Depends(auth)])
def list_tasks():
    """任务列表（不暴露 proc 句柄）。"""
    out = []
    for tid, t in tasks.items():
        status = t["status"]
        if t["proc"].poll() is not None and status == "running":
            status = "done"
            t["status"] = status
        out.append({"taskId": tid, "status": status, "createdAt": t["createdAt"]})
    return out


@app.get("/api/tasks/{task_id}", dependencies=[Depends(auth)])
def get_task(task_id: str):
    """任务详情：状态 + 日志尾部。"""
    t = tasks.get(task_id)
    if t is None:
        raise HTTPException(status_code=404, detail="task not found")
    if t["proc"].poll() is not None and t["status"] == "running":
        t["status"] = "done"
    log = (TASK_DIR / f"{task_id}.log").read_text(errors="ignore")
    return {"taskId": task_id, "status": t["status"], "logTail": log[-4000:]}


@app.get("/api/tasks/{task_id}/result", dependencies=[Depends(auth)])
def get_result(task_id: str):
    """结构化结果（评测与前端结果视图消费）。"""
    t = tasks.get(task_id)
    if t is None:
        raise HTTPException(status_code=404, detail="task not found")
    result_file = RESULT_DIR / f"{task_id}.json"
    if not result_file.exists():
        raise HTTPException(status_code=404, detail="result not ready")
    return json.loads(result_file.read_text(encoding="utf-8"))


HEARTBEAT_SEC = 15

@app.websocket("/api/ws/{task_id}")
async def stream_logs(ws: WebSocket, task_id: str, token: str | None = None):
    """WebSocket：尾随任务日志并推送。鉴权：?token=<API_TOKEN>；15s 心跳保活。"""
    if not ws_auth(token):
        await ws.close(code=4401)
        return
    await ws.accept()
    log_path = TASK_DIR / f"{task_id}.log"
    pos = 0
    last_beat = time.monotonic()
    try:
        while True:
            try:
                # 心跳：防止中间代理（Nginx）超时断开空闲连接
                now = time.monotonic()
                if now - last_beat >= HEARTBEAT_SEC:
                    await ws.send_json({"type": "ping"})
                    last_beat = now

                cur = log_path.read_text(errors="ignore")
                if pos < len(cur):
                    await ws.send_json({"type": "log", "data": cur[pos:]})
                    pos = len(cur)
                if tasks.get(task_id) and tasks[task_id]["status"] == "done":
                    await ws.send_json({"type": "status", "data": "done"})
                    break
            except Exception:
                break   # 客户端断开/发送失败
            await asyncio.sleep(0.5)
    finally:
        try:
            await ws.close()
        except Exception:
            pass


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8000")))