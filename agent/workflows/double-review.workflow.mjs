// agent/workflows/double-review.workflow.mjs
// 双评审工作流（发现者 + 复核者）——供 DSH workflow 工具使用的脚本体。
// 在 Agent 会话内让模型调用 workflow 工具并粘贴本文件 export 函数的函数体，
// 或直接引用本文件作为脚本。workflow 工具执行约定：顶级 await 可用，最后 return 结构化结果。
// 本文件以"导出函数"形式书写，保证 node --check 可验证、结果可单测。

/** 双评审工作流主体。args.task 为待审查任务。 */
export async function run({ args, agent, parallel }) {
  const task = args.task
  if (!task) throw new Error('workflow: 缺少 args.task')

  // 阶段 1：发现者与复核者并行（两个独立子代理，互不污染）
  const [discoverRaw, reviewDraft] = await parallel([
    () => agent('你是 AutoResearcher 发现者。任务：' + task +
      ' 输出 JSON：{"issues":[{"severity":"critical|warning|info","file":"","line":0,"reason":"","suggestion":""}]}。只输出 JSON。'),
    () => agent('你是 AutoResearcher 复核者。先给出评审方法论，输出 JSON：' +
      '{"falsePositives":["索引"],"missed":["补充"],"verdict":"approve|revise"}。只输出 JSON。'),
  ])

  function extractJson(out) {
    const s = out.indexOf('{')
    const e = out.lastIndexOf('}')
    if (s < 0 || e <= s) return {}
    try { return JSON.parse(out.slice(s, e + 1)) } catch { return {} }
  }

  const discover = extractJson(discoverRaw)
  // 阶段 2：复核者必须看到发现者输出后再裁决（串行）
  const review = extractJson(await agent(
    '这是发现清单：' + JSON.stringify(discover) +
    '。请结合清单输出最终 JSON：{"falsePositives":["索引"],"missed":["补充"],"verdict":"approve|revise"}。只输出 JSON。'))

  // 合并（与 scripts/review-lib.mjs 的 merge 同规则）
  const fp = new Set(review.falsePositives ?? [])
  const issues = (discover.issues ?? []).map((it, i) =>
    fp.has(String(i)) || fp.has(i) ? { ...it, severity: 'info', note: '复核者判定为误报' } : it)
  const missed = (review.missed ?? []).map((m) => ({
    severity: 'warning', file: '(未定位)', line: 0, reason: String(m), source: 'reviewer',
  }))
  return {
    schemaVersion: 1, task, verdict: review.verdict ?? 'approve',
    issueCount: issues.length + missed.length, issues: [...issues, ...missed],
  }
}
