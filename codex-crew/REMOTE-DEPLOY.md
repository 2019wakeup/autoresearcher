# 前后端分离部署：Codex（本地）→ 服务器后端（AutoResearcher）

> 本页落实核心架构约束：**前端/编排在本地，后端与 Agent 核心在 Ubuntu 服务器**。
> 代码无需改动——`mcp-server.mjs` 的 `DSH_API_BASE` 指向服务器即可（已实测配置链路生效）。

## 1. 拓扑

```text
┌──────────── 本地（你的电脑）────────────┐
│ Codex CLI                              │
│  └─ ds-autoresearcher（薄调度器）        │
│       └─ MCP: dsh_run_task(tier, task)  │
│            └─ codex-crew/mcp-server.mjs │
└──────────────────┬──────────────────────┘
                   │ HTTPS（Bearer token）
┌──────────────────▼──────────────────────┐
│ Ubuntu 服务器                           │
│  Nginx 反代（deploy/nginx.conf 已有）    │
│   └─ FastAPI 后端（:8000）              │
│        └─ spawn dsh --profile <tier>    │
│             任务/日志/结果/账本/审计     │
└─────────────────────────────────────────┘
```

## 2. 服务器端（一次性）

```bash
# 已在 Ubuntu 部署（README 部署章节），确保：
# 1) Nginx 反代 /api/ 到后端（deploy/nginx.conf 已含）
# 2) 后端 API_TOKEN 已注入（.env / systemd EnvironmentFile）
# 3) 防火墙放行 80/443；配好 TLS（certbot 等）
# 验证：curl -H "Authorization: Bearer <token>" https://<server>/api/health
```

## 3. 本地（你的电脑）

```bash
# 1) MCP server 指向远程服务器
export DSH_API_BASE=https://<server>
export DSH_API_TOKEN=<与服务器相同的 token>

# 2) Codex agent（~/.codex/agents/ds-autoresearcher.toml）
#    mcp_servers.args 指向本机 mcp-server.mjs 绝对路径（不变）

# 3) 端到端验证（连远程）
node codex-crew/scripts/smoke-mcp.mjs
```

## 4. 分离架构的红利（本实现天然满足）

| 要求 | 实现 |
|---|---|
| 前端（Codex/编排）在本地 | Codex CLI + 薄调度器 + MCP 桥都在本机 |
| 后端在服务器 | 任务/Agent/结果/审计全部在服务器 |
| 服务器无需 GUI | headless + 系统服务托管（docker/systemd） |
| 本地断网不中断任务 | 任务在服务器跑完，重连后可查（任务持久化已有） |
| 多台本地机器共享 | 多个 Codex 可指向同一服务器（同一 token/多 token） |
| 安全 | 仅暴露 /api（Bearer 鉴权）；实验/工具权限在服务器沙箱 |

## 5. 注意事项（实测）

1. **token 保护**：API_TOKEN 是服务器后端的唯一入口凭证，建议每台本地机器独立签发；
2. **CORS**：MCP 桥是服务端到服务端（Node fetch），无 CORS 限制；浏览器前端才需要考虑；
3. **错误可见性**：服务器不可达时 MCP 工具返回 fetch failed（已实测），Codex 会如实报告；
4. **WS 日志流**：远程模式下 smoke 只走 REST（任务轮询）；实时日志流（WebSocket）留给 Web 面板，不影响 Codex 指派链路。
