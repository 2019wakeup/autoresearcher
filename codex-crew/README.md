# codex-crew —— Codex 指派 AutoResearcher（方案 B 落地）

把 dsh-crew 的“薄调度器 + MCP 桥”概念搬进 AutoResearcher，绕开其未发布的 SDK 依赖
（详见 docs/DSH-CREW-REPORT.md；该报告同时验证了“对齐 rc.7 后 dsh-crew 可装”的官方路径）。

## 架构

```text
Codex（ds-autoresearcher 薄调度器，gpt-5.4-mini）
  └─ MCP: dsh_run_task(task, tier, cwd)
       └─ codex-crew/mcp-server.mjs（本目录）
            └─ POST {DSH_API_BASE}/api/tasks（Bearer 鉴权）
                 └─ 后端 spawn dsh --profile <tier-profile> "task"
                     └─ 轮询 → logTail + 结构化结果（后端全链路：审计/账本/结果落盘）
```

tier → profile 映射（环境变量可配）：
- flash → PROFILE_FLASH（默认 autoresearcher，性价比档）
- pro   → PROFILE_PRO（默认 autoresearcher，可换旗舰预设，见 DECOUPLED-MODELS.md）

## 安装（三步）

```bash
# 1. 后端跑起来（已有）：DRY_RUN=1 API_TOKEN=xxx .venv/bin/python backend/server.py

# 2. 装 MCP 依赖（首次）
cd codex-crew && npm init -y && npm i @modelcontextprotocol/sdk zod

# 3. Codex 侧：复制 agent 定义并改 mcp 路径
cp codex-agent/ds-autoresearcher.toml ~/.codex/agents/
# 编辑 ~/.codex/agents/ds-autoresearcher.toml，把 mcp_servers.args 改成你的绝对路径
# 设置环境变量（shell rc 或 Codex 配置）：
#   export DSH_API_TOKEN=xxx          # 后端 token
#   export DSH_API_BASE=http://localhost:8000
```

## 验证（无需真实 dsh / API key）

```bash
# 1. 起后端（DRY_RUN 模式）
DRY_RUN=1 API_TOKEN=test-token .venv/bin/python backend/server.py &
# 2. MCP 端到端冒烟
DSH_API_TOKEN=test-token node codex-crew/scripts/smoke-mcp.mjs
```

## 与 dsh-crew 的差异（有意为之）

| 维度 | dsh-crew | codex-crew（本实现） |
|---|---|---|
| 调度层 | SDK JSON-RPC 独立 runtime / hub | 我们已部署的 FastAPI 后端 |
| 依赖 | 未对齐版本的 SDK 家族包（rc.7 后可用） | @modelcontextprotocol/sdk + zod（公开稳定） |
| 档位 | flash/pro + escalate_on_failure | flash/pro（失败升档可加） |
| 审计 | 会话事件 | 后端全链路（日志/账本/结果落盘）已有 |
| 预设挂钩 | preset_flash/pro | PROFILE_FLASH/PRO 环境变量 |

## 路线

- [x] MCP server + Codex agent 定义（本目录）
- [ ] smoke-mcp.mjs 端到端跑通（需装 MCP 依赖后执行）
- [ ] 失败自动升档（flash 失败 → pro 重试）
- [ ] dsh-crew 官方 rc.7 对齐版发布后评估切换
