// scripts/review-lib.mjs —— 双评审纯逻辑（无副作用，可独立测试）
// 由 double-review.mjs 导入；也便于将来集成进 API 服务

/** 从模型输出中提取 JSON 块（第一个 { 到最后一个 }） */
export function extractJson(out) {
  const s = out.indexOf('{')
  const e = out.lastIndexOf('}')
  if (s < 0 || e <= s) return {}
  try { return JSON.parse(out.slice(s, e + 1)) } catch { return {} }
}

/**
 * 合并规则：
 *  - 复核者标记的误报（falsePositives，支持数字索引与字符串索引）降级为 info 并附注
 *  - 复核者补充的漏报（missed）以 warning 加入，来源标注 reviewer
 *  - verdict 透传
 */
export function merge(discover, review, task) {
  const fp = new Set(review.falsePositives ?? [])
  const issues = (discover.issues ?? []).map((it, i) =>
    fp.has(String(i)) || fp.has(i)
      ? { ...it, severity: 'info', note: '复核者判定为误报' }
      : it)
  const missed = (review.missed ?? []).map((m) => ({
    severity: 'warning', file: '(未定位)', line: 0,
    reason: String(m), suggestion: '', source: 'reviewer',
  }))
  return {
    schemaVersion: 1,
    task,
    verdict: review.verdict ?? 'approve',
    issueCount: issues.length + missed.length,
    issues: [...issues, ...missed],
  }
}

/** 发现者提示词：产出结构化问题清单 */
export function discovererPrompt(task) {
  return '你是 AutoResearcher 发现者。任务：' + task +
    '\n输出 JSON：{"issues":[{"severity":"critical|warning|info","file":"...","line":0,"reason":"...","suggestion":"..."}]}。' +
    '只输出 JSON。'
}

/** 复核者提示词：只评审发现清单（防自说自话） */
export function reviewerPrompt(task, findings) {
  return '你是 AutoResearcher 复核者。你的职责是挑战下面的发现清单，找出误报与漏报。' +
    '\n原始任务：' + task +
    '\n发现清单：' + findings +
    '\n输出 JSON：{"falsePositives":["issue索引"],"missed":["补充问题"],"verdict":"approve|revise"}' +
    '\n只输出 JSON。'
}
