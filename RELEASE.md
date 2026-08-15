# AutoResearcher 发布说明（Release Notes）

## v1.13.0（2026-08）—— 首个可部署基线

从博客教程落地的**企业级科研 Agent 工程**：文献调研 / 实验运行 / 数据分析，前后端分离，后端可部署于 Ubuntu 远程主机。

### 包含内容

| 模块 | 说明 |
|---|---|
| backend/ | FastAPI 服务：任务注册表（内存+磁盘持久化）、Bearer 鉴权、WebSocket 日志流（15s 心跳）、DRY_RUN 模式（无 dsh 可测）、单进程前端托管 |
| plugin/ | Cordis 工具插件 ×5：arxiv_search / parse_pdf / literature_survey / run_experiment（白名单+超时+资源熔断+记账）/ 双评审逻辑；22 个单测 |
| frontend/ | React 面板：任务创建/列表/日志流（断线重连）/ 结果视图（严重度彩色渲染） |
| evals/ | 10 个评测 case（文献/实验/数据/安全四类）+ manifest 驱动跑批 + 预算门禁 |
| deploy/ | Docker Compose / systemd / Nginx（compose 配置已真实验证） |
| scripts/ | 冒烟测试（真实 5/5 PASS）、双评审编排器、一键装配 setup-agent |
| ci/ | GitHub Actions：test 门禁 + eval 门禁（tag/手动，≥90%） |
| docs/ | README（使用+部署）/ ARCHITECTURE（架构+扩展）/ OPERATIONS（运维） |

### 验证矩阵（全部真实执行）

```text
pytest（后端 API+持久化）    10/10  PASS
vitest（插件单测）           22/22  PASS
tsc --noEmit（strict）       0 errors
vite build（前端生产构建）   通过（148KB / 27 模块）
端到端冒烟（真实子进程）      5/5   PASS
docker compose config        通过（Docker 28.0.1）
node --check / js-yaml / JSON / bash -n   全绿
```

### 已知限制

1. **docker build 未在本机完成**：node:22-slim 基础镜像拉取在本机网络反复挂起（环境问题）；镜像构建需在 Ubuntu 主机执行（`docker compose up -d --build`）；
2. **真实 dsh 集成未在本机验证**：需要 DSH 环境与 API key；在目标主机执行 `make setup-agent` 后跑 `make eval` 建立质量基线；
3. WebSocket 生产版建议加心跳超时熔断调优（当前 45s）。

### 部署路径（Ubuntu 主机）

```bash
git clone <你的远端> && cd autoresearcher
make setup && make test && make smoke   # 本地验证（无需 dsh 的部分）
make setup-agent                        # 装配插件+预设（需 dsh）
cd deploy && docker compose up -d --build   # 或 systemd 方案
```

### 后续路线（候选）

- 多 Agent 双评审接入后端任务（`/api/reviews` 端点）
- GPU 配额可视化（前端展示 ledger）
- 评测集持续扩充（真实科研任务样例）
- 前端任务详情页增强（diff 视图、评审报告导出）
