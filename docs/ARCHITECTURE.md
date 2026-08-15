# AutoResearcher 架构文档

> 面向开发者：理解各组件职责、数据流与扩展方式。配合 README（使用）与 docs/OPERATIONS.md（运维）阅读。

## 1. 系统架构（前后端分离三层）

```text
┌─────────────────────────────────────────────────────────────┐
│ 前端层 frontend/（React + Vite，静态站点）                    │
│  ├─ src/App.tsx        任务创建 / 列表 / 日志流 / 结果视图      │
│  ├─ src/api.ts         API 客户端（REST + WebSocket 重连）     │
│  └─ dist/              构建产物（Nginx 托管或后端单进程托管）   │
└───────────────────────┬─────────────────────────────────────┘
                        │ REST /api/* + WS /api/ws/*（Bearer token）
┌───────────────────────▼─────────────────────────────────────┐
│ 后端层 backend/（FastAPI，Python 3.12）                       │
│  ├─ server.py         任务注册表（内存+磁盘索引）、鉴权、       │
│  │                    子进程编排（dsh 或 DRY_RUN 假任务）、     │
│  │                    WebSocket 日志流（15s 心跳）             │
│  ├─ test_api.py       10 个 pytest（契约+生命周期+持久化）      │
│  └─ requirements.txt                                          │
│          │  spawn dsh --profile <P> "task"                    │
┌──────────▼──────────────┐                                     │
│ Agent 核心（DSH）        │  ← 装配：make setup-agent           │
│  ├─ agent/agent.cordis.yml  （预设：只读+受控实验）            │
│  ├─ plugin/  （Cordis 工具插件）                              │
│  │   ├─ arxiv.ts        arXiv 检索                           │
│  │   ├─ pdf.ts          PDF 解析                             │
│  │   ├─ survey.ts       文献调研（检索→下载→解析→索引）        │
│  │   ├─ experiment.ts   实验运行（白名单+超时+资源熔断+记账）   │
│  │   └─ resource.ts     预算账本/GPU磁盘预检/熔断决策          │
│  └─ workflows/          双评审 workflow 脚本                  │
└─────────────────────────────────────────────────────────────┘
        │ 输出                                        │
┌───────▼──────────┐                    ┌────────────▼──────────┐
│ data/tasks/*.log │  审计/日志          │ data/results/*.json   │
│ data/logs/       │  实验日志            │ data/papers/          │
│ data/ledger.json │  预算账本            │ data/tasks/index.json │
└──────────────────┘                    └───────────────────────┘
        │                                        │
        ▼                                        ▼
   scripts/smoke.mjs（冒烟）              evals/run-evals.mjs（评测门禁）
   scripts/double-review.mjs（双评审）     evals/manifest.json（10 case）
   scripts/setup-agent.mjs（一键装配）     ci/（GitHub Actions test+eval）
```

## 2. 数据流（一次科研任务的完整旅程）

```text
1. 前端 POST /api/tasks {task, profile?}（Bearer 鉴权）
2. 后端校验 → 落盘任务索引 → spawn dsh --profile <P> "task"（或 DRY_RUN 假进程）
3. dsh 内 Agent 循环：
   literature_survey / arxiv_search（检索）→ parse_pdf（精读）
   → run_experiment（白名单检查 → 资源熔断预检 → 运行 → 记账）
   → 模型产出结构化 JSON（如 {"issues":[...]}）
4. 进程退出 → _collect_result 提取 JSON 块 → data/results/{id}.json
5. 前端轮询/WS 收日志与状态 → 完成后 GET /result 渲染（严重度彩色）
6. 审计：data/tasks/{id}.log 全量留存；评测：evals 定期回归
```

## 3. 组件职责与关键设计决策

| 组件 | 职责 | 关键决策 |
|---|---|---|
| server.py | API 网关 + 任务编排 | 任务子进程隔离；DRY_RUN 可无 dsh 测全链路；任务索引持久化（重启不丢） |
| experiment.ts | 实验执行 | **三条铁律**：白名单路径（防 ../ 逃逸）、超时 SIGKILL、日志全量落盘；前置资源熔断 |
| resource.ts | 预算治理 | 账本跨天滚动；四重熔断（实验数/时长/磁盘/GPU）；纯函数可单测 |
| review-lib.mjs | 双评审合并 | 误报降级 info 附注；漏报补充（source=reviewer）；隔离会话防自说自话 |
| evals | 质量门禁 | manifest 驱动 + 预算门禁（正确性×成本双指标）；DSH_PROFILE 可指向自定义预设 |
| ci.yml | 发布门禁 | test 门禁（单测/构建/冒烟）+ eval 门禁（tag/手动，≥90%） |

## 4. 扩展指南（怎么加一个新能力）

1. **加工具**：plugin/src/ 新增模块（纯逻辑）+ index.ts 注册（name/parameters/output 契约）+ test/ 单测 → `make setup-agent` 重新装配；
2. **加评测**：evals/manifest.json 加 case（id/task/graders/budget）→ 跑 `DSH_PROFILE=... node evals/run-evals.mjs`；
3. **加后端能力**：server.py 加路由 + test_api.py 加用例（DRY_RUN 下可测）；
4. **加工作流**：agent/workflows/ 新增脚本（参考 double-review.workflow.mjs 的导出 run() 约定）。

## 5. 一致性保证

- **契约先行**：每个工具声明规范输出 schema（output），前端/评测/CI 都消费同一结构；
- **评测即回归**：任何预设/工具/提示词改动必须过评测门禁（防模型升级"悄悄变笨"）；
- **双平面原则**：注册表/沙箱/审批在宿主平面；工具/提示词在预设平面（见博客第 3 篇）；
- **不给工具 = 做不了**：预设刻意不注册写工具，是科研 Agent 最强的范围控制。
