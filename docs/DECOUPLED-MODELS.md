# 解耦模型架构：Planner 旗舰 + Executor 性价比（DSH 原生支持）

> 目标：在科研 Agent 中，规划用 OpenAI 旗舰模型，执行节点动态替换为
> DeepSeek V4 Flash 等性价比模型——"好钢用在刀刃上"的模型成本结构。
> 结论：**完全可行，DSH 为它原生设计了三级机制**（本文档基于 0.1.0-rc.6 源码与官方仓库核验）。

## 1. 为什么可行：DSH 模型层的原生设计

### 层 0：多 provider 共存（LlmRuntime）

DSH 的 LLM 层是 `ctx.llm`（LlmRuntime）——一个**适配器注册表**：
- `registerAdapter(providers, adapter)`：多个 provider（deepseek / openai / pi-ai…）可同时注册路由；
- 官方仓库 `packages/llm/` 目录即 `llm`（抽象）+ `llm-deepseek`、`llm-pi-ai`、`llm-retry`（实现）；
- `llm/stream` waterfall：**每次模型调用都可被插件拦截**（缓存/日志/路由）——动态路由的官方扩展点；
- HMR 支持适配器热替换，注册变更发出 `llm/adapters-updated` 事件。

### 层 1：per-agent 模型路由

每个 Agent 有自己独立的 model route（persona 的 `{{model}}` 从 "the agent's own route" 解析）。
→ 不同预设/会话可配置不同模型：planner 预设路由到 OpenAI 旗舰，executor 预设路由到 V4 Flash。

### 层 2：workflow 逐节点模型覆盖（本项目的实现方式）

`dsh-workflow-worker-thread` 的 `agent()` 支持 **per-node model 参数**：
`agent(prompt, { model: 'deepseek-v4-flash' })`——每个执行节点可独立指定模型；
provider 也可覆盖（某些节点可路由到 codex / claude-code 产品引擎）。

### 层 3：子代理模型继承/覆盖

spawn 子代理"默认继承父 agent 模型（**除非覆盖**）"——覆盖通道由
`WorkflowStartRequest.subagentProvider` / 模型字段提供。

## 2. 推荐架构（本项目的落地）

```text
┌─ Planner Agent（per-agent route = OpenAI 旗舰）─────────────┐
│  只读探索 + 产出结构化计划（steps[]，每步标 critical）        │
└───────────────┬─────────────────────────────────────────────┘
                │ 计划 JSON
┌───────────────▼─────────────────────────────────────────────┐
│ Workflow 编排（decoupled-research.workflow.mjs）             │
│  每个步骤: agent(step, { model: 节点模型 })                  │
│  · 普通节点 → deepseek-v4-flash（性价比）                    │
│  · critical 节点 → 自动升级旗舰                             │
│  · 覆盖表 criticalNodes[stepId] → 显式指定任意模型           │
│  汇总节点 → 旗舰（跨节点裁决需要最强推理）                   │
└─────────────────────────────────────────────────────────────┘

成本结构：旗舰 × (1 规划 + critical 节点 + 1 汇总) + flash × 其余
→ 总成本 ≈ 全程旗舰的 1/N（N = 执行节点数）
```

## 3. 配置示例

### 3.1 两个 provider 注册（settings / profile patch 层，示意）

```yaml
# 示意：provider 注册与各自凭据（以官方 llm 包的实际 schema 为准）
llm:
  providers:
    - name: openai
      adapter: llm-openai          # 社区或自研适配器（官方现装 deepseek / pi-ai）
      settings: { baseURL: "https://api.openai.com/v1", model: "gpt-5.x" }
    - name: deepseek
      adapter: llm-deepseek
      settings: { baseURL: "https://api.deepseek.com", model: "deepseek-v4-flash" }
```

> 注：0.1.0-rc.6 官方发行自带 `llm-deepseek` 与 `llm-pi-ai`；OpenAI provider 可用
> 社区桥接（如 dsh-codex-connect）或自写一个 `llm-openai` 适配器（实现 LlmAdapter 即可）。

### 3.2 planner 预设的 route（示意）

```yaml
# planner 预设：只读 + 规划，模型指向旗舰
- id: persona
  name: '@deepseek-ai/dsh-persona'
  config: { text: "You are a research planner..." }
# route 配置随部署设置（{{model}} 解析来源）
```

### 3.3 workflow 调用（模型参数化）

```js
workflow({
  args: {
    task: "调研 KV cache 优化并给出实验方案",
    plannerModel: process.env.PLANNER_MODEL ?? "openai-gpt-5.x",
    executorModel: process.env.EXECUTOR_MODEL ?? "deepseek-v4-flash",
    criticalNodes: { "实验运行": "openai-gpt-5.x" },
  },
})
```

## 4. 已验证（本仓库）

- `agent/workflows/decoupled-research.workflow.mjs`：模型选择逻辑 8/8 单测通过
  （planner 旗舰 / 普通节点 flash / critical 自动升级 / 覆盖表显式升级 / 汇总旗舰）；
- 语法：node --check ✅。

## 5. 注意事项（实测认知）

1. **凭据**：每个 provider 独立 key（OpenAI + DeepSeek），环境变量注入，不入库；
2. **KV 缓存**：不同模型的子代理请求前缀彼此独立（官方文档确认），无跨模型缓存复用；
3. **工具呈现**：若执行节点用不同 provider，注意 PTC SDK / 工具过滤按子 agent 作用域生效，
   节点间能力面可不同（这正是"解耦"的一部分）；
4. **真实端到端**：本机无 OpenAI key / DSH 运行时，未真跑跨模型调用——部署后
   `PLANNER_MODEL=... EXECUTOR_MODEL=...` 跑通一次即建立基线；
5. **动态语义**：workflow 逐节点覆盖 = 每次任务可变的"动态替换"；
   若要"运行中按水位切换"，走 `llm/stream` waterfall 写路由插件（层 0 扩展点）。

## 6. 演进路线

- [ ] 自写 `llm-openai` 适配器（实现 LlmAdapter，~100 行）
- [ ] `llm/stream` 路由插件：按节点类型/成本水位动态选模型（层 0）
- [ ] planner/executor 双预设（层 1）与 workflow 覆盖（层 2）结合
- [ ] 评测集加"模型路由正确性"用例（断言执行节点确实用了 flash）
