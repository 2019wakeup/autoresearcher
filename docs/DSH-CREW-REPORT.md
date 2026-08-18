# dsh-crew 调研报告与集成方案（2026-08）

> 研究对象：github.com/ZSeven-W/dsh-crew（v0.1.0-rc.1，源码已完整 clone 至 ../vendor/dsh-crew）
> 目标：把"Codex/Claude Code 指派 DSH worker"机制集成进 AutoResearcher 科研 Agent
> 结论：架构值得借鉴，但**当前无法直接安装**（peer 依赖未发布）；给出替代集成路径（方案 B）。

## 1. dsh-crew 架构解读（源码级）

### 机制链

```text
Codex / Claude Code（orchestrator，模型不变）
  └─ ds-flash / ds-pro agent（薄调度器：自己绝不做任务）
       └─ MCP 工具 dsh_run_worker(tier, effort, cwd)
            ├─ hub 模式：DSH Web 在跑 → worker 成为 DSH 一等公民会话（Web UI 可见）
            └─ standalone：dsh-jsonrpc-agent 拉起 worker.cordis.yml 独立 runtime
                 └─ SDK initialize 握手时由调用方指定模型/provider ← 动态模型替换的官方通道
```

### 关键设计（逐一评估）

| 设计 | 实现 | 对我们科研 Agent 的价值 |
|---|---|---|
| 薄调度器 | codex/agents/ds-flash.toml：自己不做任务，任务 VERBATIM 传给 MCP 工具；Codex 侧用 gpt-5.4-mini | ★★★ 隔离"指派"与"执行" |
| 档位 tier | flash = deepseek-v4-flash / pro = deepseek-v4-pro；tier_policy 可强制全收敛某档 | ★★★ 正是上一轮"executor 动态换模型"的实现 |
| 失败升档 | escalate_on_failure：flash 失败自动用 pro 重试一次（依据结果而非事前猜） | ★★★ 值得抄进我们的 workflow |
| 双运行路径 | hub（DSH Web 常驻）/ standalone（独立 runtime 回落） | ★★ hub 等价于我们的常驻后端 |
| 模型注入 | "Model/provider arrive per process via the SDK initialize handshake" | ★★★ 动态替换的官方机制 |
| 预设挂钩 | preset_flash / preset_pro 可指向任意 DSH 预设 | ★★★ 可指向 AutoResearcher 预设 = worker 用我们的科研工具 |
| 多模态桥 | describe_image / generate_image（借本机已登录 CLI） | ★ 可选 |
| 状态栏/面板 | statusline + client.tsx 面板 | ★★ 监控好帮手 |

## 2. 集成障碍（实测证据）

1. **peer 依赖版本冲突（致命）**：dsh-crew 要求 @deepseek-ai/dsh-sdk-client ^0.1.0-rc.5、
   dsh-sdk-jsonrpc-server 0.1.0-rc.6、dsh-agent-spine-demo 0.1.0-rc.6 等；
   公开 npm 上这些包最新只有 **0.0.1-rc.1 / 0.0.1-rc.5**（实测 npm view）。
   `npm install` 实测失败：ERESOLVE peer 冲突。
   → --legacy-peer-deps 可强装，但 jobs.mjs 顶层 import dsh-sdk-client，0.0.1 版 API 可能不兼容，风险高。
2. **路径硬编码**：codex/agents/*.toml 的 MCP server 路径是作者本机
   （/Users/fini/workspace/dsh-plugins/dsh-crew/src/server.mjs），需改。
3. **Codex 依赖**：Codex CLI + 订阅（gpt-5.4-mini 调度器）。

## 2.5 实测更新：对齐 rc.7 后可以干净安装（2026-08-18 验证）

- 现状：npm 上 DSH SDK 家族已有 **0.1.0-rc.7**（dsh-sdk-client / dsh-sdk-jsonrpc-server 等）；
  dsh-crew 0.1.0-rc.1 的 package.json 锁定 rc.6 精确版本，npm 混版本解析（dsh-system-prompt rc.7
  要求 dsh-llm rc.7）导致 ERESOLVE。
- 解法（“更新 dsh 版本”）：把 dsh-crew 的 dev/peer 依赖整体对齐 ^0.1.0-rc.7 后，
  **npm install 成功（72 个 @deepseek-ai 包装入，sdk-client / jsonrpc-server = rc.7）**；
  MCP server（src/server.mjs）stdin 保持时正常运行。
- 含义：等 dsh-crew 作者发布 rc.7 对齐版本即可直接 `dsh plugin add`；本地可用
  `npm install --legacy-peer-deps` 或版本对齐先跑起来。
- 我们的方案 B（codex-crew）不受影响：依赖只有 @modelcontextprotocol/sdk + zod（公开稳定）。

## 3. 集成方案

### 方案 A：等官方 SDK 包发布（零改动，但被动）
0.1.0-rc.6 的 sdk 家族包随 deepseek-harness 构建链发布后，`dsh plugin add @zseven-w/dsh-crew` 即可。
跟踪：github.com/deepseek-ai/deepseek-harness 的 packages/ 下 sdk-* 包发布状态。

### 方案 B（推荐）：自研 codex-crew 迷你集成（绕开未发布包）
洞察：**dsh-crew 的 standalone 路径 = "常驻调度层 + 按请求拉起 DSH worker"——我们的 AutoResearcher 后端
（FastAPI 任务注册表 + spawn dsh headless）就是这个调度层的已部署实现**。所以：
只搬 dsh-crew 的"薄调度器 + MCP 桥"概念，MCP server 直接调我们的后端 API：

```text
Codex（薄调度器 agent，模型自选）
  └─ MCP 工具 dsh_run_task(task, tier, cwd)
       └─ codex-crew/mcp-server.mjs
            └─ POST {backend}/api/tasks（Bearer token，profile 按 tier 映射）
                 └─ 后端 spawn dsh --profile <tier-profile> "task"（已有能力！）
                     └─ 轮询 → 结果/日志/审计（后端全链路已有）
```

- tier 映射：flash → profile "autoresearcher"（flash 预设），pro → profile "autoresearcher-pro"（旗舰预设，预留）；
  与上一轮 DECOUPLED-MODELS.md 的 planner/executor 架构同构——Codex 即"planner"（你已在用的旗舰/调度），
  DSH worker 即"executor"（按档位换模型）。
- 零新增依赖风险：@modelcontextprotocol/sdk + zod 已在 npm 公开稳定。
- 立即可验证：后端 DRY_RUN 模式即可端到端测试（无需真实 dsh/API key）。

### 方案 C：混合（A 发布后切官方，B 先用起来）
B 的 MCP 工具契约（dsh_run_task/status/result/cancel）与 dsh-crew 对齐，
将来官方包可用时无缝切换。

## 4. 建议

- 短期：实施方案 B（见 codex-crew/ 目录），本机 DRY_RUN 端到端验证；
- 中期：Codex 侧薄 agent 用便宜的模型（如 gpt-5.4-mini 思路），DSH worker 按 tier 用 V4 Flash/Pro；
- 长期：跟踪 dsh-crew 依赖的 SDK 包发布，评估切换官方实现；
- 安全：Codex 侧 MCP 工具需 approval（照 dsh-crew 的 default_tools_approval_mode=approve）；
  后端 /api/tasks 已有 Bearer 鉴权与审计，天然满足。