"""AutoResearcher 后端 API 测试（DRY_RUN 模式，无需 dsh）。

运行：.venv/bin/python -m pytest backend/test_api.py -v
"""
import os
import time

# 必须在导入 server 前设置环境（server 模块加载时读取）
os.environ["DRY_RUN"] = "1"
os.environ["API_TOKEN"] = "test-token"

import pytest
from fastapi.testclient import TestClient

import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__)))
import server  # noqa: E402


@pytest.fixture()
def client():
    return TestClient(server.app)


def auth_headers():
    return {"Authorization": "Bearer test-token"}


def test_health(client):
    r = client.get("/api/health", headers=auth_headers())
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["dryRun"] is True


def test_auth_required(client):
    r = client.get("/api/tasks")   # 无 token
    assert r.status_code == 401


def test_auth_wrong_token(client):
    r = client.get("/api/tasks", headers={"Authorization": "Bearer wrong"})
    assert r.status_code == 401


def test_create_task_and_complete(client):
    r = client.post("/api/tasks", headers=auth_headers(),
                    json={"task": "冒烟测试任务"})
    assert r.status_code == 200
    task_id = r.json()["taskId"]
    assert r.json()["status"] == "running"

    # DRY_RUN 假任务约 2 秒完成
    detail = None
    for _ in range(20):
        time.sleep(0.3)
        detail = client.get("/api/tasks/" + task_id, headers=auth_headers())
        if detail.json()["status"] == "done":
            break
    assert detail is not None
    assert detail.json()["status"] == "done"
    assert "dry-run" in detail.json()["logTail"]


def test_result_collected(client):
    r = client.post("/api/tasks", headers=auth_headers(),
                    json={"task": "产出结果的任务"})
    task_id = r.json()["taskId"]
    for _ in range(20):
        time.sleep(0.3)
        d = client.get("/api/tasks/" + task_id, headers=auth_headers())
        if d.json()["status"] == "done":
            break
    result = client.get("/api/tasks/" + task_id + "/result",
                        headers=auth_headers())
    assert result.status_code == 200
    body = result.json()
    assert body["dryRun"] is True
    assert body["ok"] is True


def test_task_not_found(client):
    r = client.get("/api/tasks/nonexistent", headers=auth_headers())
    assert r.status_code == 404


def test_empty_task_rejected(client):
    r = client.post("/api/tasks", headers=auth_headers(), json={"task": "  "})
    assert r.status_code == 422


def test_list_tasks(client):
    r = client.get("/api/tasks", headers=auth_headers())
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_task_index_persists_after_restart(client):
    """模拟重启：完成的任务应在索引中恢复为 done。"""
    r = client.post("/api/tasks", headers=auth_headers(),
                    json={"task": "持久化测试任务"})
    task_id = r.json()["taskId"]
    for _ in range(20):
        time.sleep(0.3)
        d = client.get("/api/tasks/" + task_id, headers=auth_headers())
        if d.json()["status"] == "done":
            break
    # 模拟重启：从磁盘重新加载索引
    restored = server.load_task_index()
    assert task_id in restored
    assert restored[task_id]["status"] == "done"
    assert restored[task_id]["doneAt"] > 0


def test_index_corrupt_recovers(client):
    """索引损坏时启动不崩溃（回到空历史）。"""
    corrupt = server.TASK_INDEX
    corrupt.write_text("{broken json", encoding="utf-8")
    restored = server.load_task_index()
    assert isinstance(restored, dict)
