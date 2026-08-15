# AutoResearcher —— 科研自动化 Agent（前后端分离）

> 部署在你自己 Ubuntu 主机上的科研 Agent：**文献调研 / 实验运行 / 数据分析**。
> 架构：独立前端 Web 面板 + 独立后端服务（FastAPI）+ Agent 核心（DSH headless）。
> 本工程是博客《从零到一：Agent 开发实战》第 4 篇的**可运行落地**，配套教程见 `../agent-blog/`。

## 目录结构

```text
autoresearcher/
├── backend/          # FastAPI 服务：任务注册表 / 鉴权 / WebSocket 日志流
├── plugin/           # Cordis 工具插件：arxiv_search / run_experiment / parse_pdf
├── frontend/         # React 面板（Vite）：任务创建 / 列表 / 日志流
├── evals/            # 评测集（manifest 驱动）+ 跑批脚本（CI 门禁）
├── deploy/           # Docker Compose / Dockerfile / Nginx / systemd
├── agent/            # AutoResearcher 预设（agent.cordis.yml）
├── data/
│   └── scripts/      # 实验脚本白名单目录（run_experiment 只能跑这里）
└── .env.example      # 环境变量模板（复制为 .env）
```

## 快速开始（本地开发）

> 推荐用 Makefile 一键操作：`make setup && make test && make smoke`（详见各小节）。


### 1. 后端 API

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
API_TOKEN=dev-token python server.py
# 验证：curl -H "Authorization: Bearer dev-token" http://localhost:8000/api/health
```

### 2. 前端面板

```bash
cd frontend
npm install
VITE_API_TOKEN=dev-token npm run dev     # http://localhost:5173（/api 已代理到后端）
```

### 3. 工具插件（DSH 侧）

```bash
cd plugin
npm install
npm test              # 工具级单测（arxiv 解析 / 实验运行器安全）
npm run build         # 产出 dist/
# 将 @autoresearcher/plugin-research 安装进你的 DSH profile：
#   dsh plugin --profile <你的profile> add ./plugin
# 然后在新会话选择 autoresearcher 预设（见 agent/agent.cordis.yml）
```

### 4. 评测（进 CI 的门禁）

```bash
cd evals
DEEPSEEK_API_KEY=xxx node run-evals.mjs   # 通过率 ≥ 90% 才 exit 0
```

### 5. 端到端冒烟（无需 dsh 也能测通 API 契约）

```bash
cd backend && pip install -r requirements.txt   # 首次
DRY_RUN=1 API_TOKEN=dev-token python server.py &   # DRY_RUN 模式用假任务进程
cd .. && API_TOKEN=dev-token node scripts/smoke.mjs   # 全部 PASS 即 API 契约正确
```


## 部署到 Ubuntu 远程主机

### 方案 A：Docker Compose（推荐）

```bash
# 服务器上（首次）
git clone <你的仓库> /opt/autoresearcher && cd /opt/autoresearcher
cp .env.example .env && vim .env          # 填 DEEPSEEK_API_KEY / API_TOKEN
cd frontend && npm install && npm run build   # 产出 frontend/dist

cd deploy
DEEPSEEK_API_KEY=xxx API_TOKEN=xxx docker compose up -d --build
# 前端 http://<host>:8080   后端 http://<host>:8000
```

### 方案 B：systemd（不用 Docker）

```bash
sudo useradd -m -s /bin/bash researcher
sudo mkdir -p /opt/autoresearcher && sudo chown researcher:researcher /opt/autoresearcher
# 把项目放到 /opt/autoresearcher，.env 填好
sudo cp deploy/autoresearcher.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now autoresearcher
```

### Nginx 反代（一个域名同时服务前后端）

```bash
sudo cp deploy/nginx.conf /etc/nginx/conf.d/autoresearcher.conf
sudo nginx -t && sudo systemctl reload nginx
```

## 多 Agent 双评审（v1.5）

发现者 + 复核者两阶段评审，两个隔离的 DSH 会话并行工作：

```bash
# 独立编排器（适合 CI/后端集成）
node scripts/double-review.mjs "审查 src/ 下最近的改动"

# 会话内 workflow 版（适合 Agent 自主调用）
# 见 agent/workflows/double-review.workflow.mjs
```

合并规则：复核者标记的误报降级为 info 并附注；漏报以 warning 补充（source=reviewer）。


## 安全基线（务必阅读）

1. **API_TOKEN 必须注入**（`.env` / systemd EnvironmentFile），前端面板也只持有这个 token；
2. **实验脚本白名单**：`run_experiment` 只能运行 `data/scripts/` 下的脚本（路径逃逸被拒），并强制超时（SIGKILL）；
3. **高危操作审批**：生产环境应为实验运行类工具配置人工审批（DSH 审批栈）；
4. **凭据目录禁读**：在宿主 fs 策略中 deny `.ssh`、`.aws`、`.env`；
5. **审计**：所有任务日志落盘 `data/logs/`（`run_experiment` 全量日志），可回放可追责；
6. **评测门禁**：模型升级 / 预设改动必须跑 `evals/run-evals.mjs`，防"悄悄变笨"。

## 路线图（后续迭代候选）

- [x] 文献调研工作流（检索 → 下载 PDF → 精读 → 结构化笔记）—— v1.2 已实现首轮索引（literature_survey）
- [x] 任务结果结构化视图 —— v1.1 已实现基础版（/api/tasks/{id}/result + 前端渲染）
- [x] GPU/磁盘配额与熔断（实验资源治理）—— v1.3 已实现（data/ledger.json 预算账本 + 四重熔断）
- [x] WebSocket 心跳与断线重连（生产化）—— v1.4 已实现（15s 心跳 + 指数退避重连）
- [x] 多 Agent：发现者 + 复核者双评审 —— v1.5 已实现（scripts/double-review.mjs 独立编排器 + agent/workflows 会话内 workflow 版，合并规则经 15 项逻辑测试）
- [x] 评测集扩充（真实科研任务样例）—— v1.6 已有 10 个 case（文献/实验/数据/安全四类）
- [x] 端到端冒烟测试 —— v1.6 已实现（scripts/smoke.mjs，本机真实运行 5/5 PASS）
- [ ] WebSocket 心跳与断线重连（生产化）
- [ ] 评测集扩充（真实科研任务样例）

## 相关文档

- 配套教程：`../agent-blog/04-实战-科研Agent项目.md`（架构决策与逐章节说明）
- DSH 官方仓库：<https://github.com/deepseek-ai/dsh>