// agent/workflows/decoupled-research.workflow.mjs
// 解耦模型架构示例：Planner（旗舰模型）→ Executor 节点（性价比模型，可逐节点覆盖）
//
// 用法（DSH workflow 工具，args 传参）：
//   workflow({
//     args: {
//       task: "调研 KV cache 优化并给出实验方案",
//       plannerModel: "openai-gpt-5.x",        // 规划：旗舰模型
//       executorModel: "deepseek-v4-flash",    // 执行：性价比模型
//       criticalNodes: { "实验运行": "openai-gpt-5.x" },  // 关键节点升级模型
//     }
//   })
//
// 设计要点（对应 docs/DECOUPLED-MODELS.md 的层 2）：
//   - planner 只做规划（一次旗舰调用）；executor 按计划批量执行（flash 为主）
//   - 每个 agent() 调用可独立指定 model —— DSH workflow 引擎原生支持
//   - 成本结构：旗舰 × 1 次 + flash × N 次，总成本远低于全程旗舰

/** 解耦科研工作流主体。 */
export async function run({ args, agent }) {
  const task = args.task
  const plannerModel = args.plannerModel ?? process.env.PLANNER_MODEL ?? 'openai-gpt-5.x'
  const executorModel = args.executorModel ?? process.env.EXECUTOR_MODEL ?? 'deepseek-v4-flash'
  const criticalNodes = args.criticalNodes ?? {}
  if (!task) throw new Error('workflow: 缺少 args.task')

  // ── 阶段 1：Planner（旗舰模型）——只读分析 + 产出结构化计划 ──
  const plan = await agent(
    '你是科研规划者。任务：' + task +
    '。输出 JSON 计划：{"steps":[{"id":"s1","title":"...","desc":"...","critical":false}]}，' +
    'critical=true 表示需要最强模型的关键节点（如实验设计/结论裁决）。只输出 JSON。',
    { model: plannerModel, schema: {
      type: 'object', required: ['steps'],
      properties: { steps: { type: 'array', items: {
        type: 'object', required: ['id', 'title', 'desc', 'critical'],
        properties: {
          id: { type: 'string' }, title: { type: 'string' },
          desc: { type: 'string' }, critical: { type: 'boolean' },
        },
      } } },
    } },
  )

  // ── 阶段 2：Executor 节点（默认性价比模型，关键节点动态升级）──
  const results = []
  for (const step of plan.steps) {
    // 动态模型选择：节点级覆盖表 > 节点 critical 标记 > 默认执行模型
    const nodeModel = criticalNodes[step.id] ?? (step.critical ? plannerModel : executorModel)
    const out = await agent(
      '执行科研计划步骤 [' + step.id + '] ' + step.title + '：' +
      step.desc + '。任务背景：' + task + '。输出简洁 JSON 结果。',
      { model: nodeModel },
    )
    results.push({ id: step.id, title: step.title, model: nodeModel, output: out })
  }

  // ── 阶段 3：汇总（结论节点用旗舰，因为要跨节点裁决）──
  const summary = await agent(
    '汇总以下执行结果，输出最终科研结论 JSON：' +
    JSON.stringify(results).slice(0, 12000),
    { model: plannerModel, schema: {
      type: 'object', required: ['conclusion', 'openQuestions'],
      properties: {
        conclusion: { type: 'string' },
        openQuestions: { type: 'array', items: { type: 'string' } },
      },
    } },
  )

  return {
    schemaVersion: 1,
    plan: plan.steps.map(function (s) { return { id: s.id, title: s.title, critical: s.critical } }),
    executions: results,
    summary: summary,
    modelUsage: { plannerModel: plannerModel, executorModel: executorModel, nodeUpgrades: Object.keys(criticalNodes) },
  }
}
