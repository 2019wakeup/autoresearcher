// evals/run-evals.mjs —— 评测跑批：manifest 驱动 + 预算门禁 + 报告
// 用法：DEEPSEEK_API_KEY=xxx node evals/run-evals.mjs
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const manifest = JSON.parse(readFileSync('evals/manifest.json', 'utf8'))
console.log('评测集 v' + manifest.schemaVersion + '，共 ' + manifest.cases.length + ' 个用例')

// 辅助 1：跑一次 headless 任务（隔离、可重复）
function runHeadless(task) {
  return execSync('dsh --profile headless "' + task + '"', {
    encoding: 'utf8', timeout: 120_000, maxBuffer: 16 * 1024 * 1024,
  })
}

// 辅助 2：从输出中提取 JSON（第一个 { 到最后一个 }）
function extractReportJson(out) {
  const start = out.indexOf('{')
  const end = out.lastIndexOf('}')
  if (start < 0 || end <= start) return {}
  try { return JSON.parse(out.slice(start, end + 1)) } catch { return {} }
}

// 辅助 3：简化 JSONPath（支持 $.a.b 与 $.arr[0].x）
function jsonPath(obj, path) {
  const keys = path.replace(/^\.?\$\.?/, '').split('.')
  return keys.reduce((acc, key) => {
    const m = key.match(/^(\w+)\[(\d+)\]$/)
    if (m) return acc && acc[m[1]] && acc[m[1]][Number(m[2])]
    return acc && acc[key]
  }, obj)
}

// 辅助 4：三种 grader（json-path / count / regex）
function grade(g, report) {
  const v = jsonPath(report, g.path)
  if (g.type === 'json-path') {
    if (g.mustExist && v === undefined) return false
    if (g.mustMatch && !String(v ?? '').includes(g.mustMatch)) return false
    if (g.mustEqual !== undefined && v !== g.mustEqual) return false
    return true
  }
  if (g.type === 'count') return (Array.isArray(v) ? v.length : 0) >= (g.min ?? 1)
  if (g.type === 'regex') {
    const flags = g.caseInsensitive ? 'i' : ''
    return new RegExp(g.pattern, flags).test(JSON.stringify(report))
  }
  return false
}

// 主流程
const results = []
for (const c of manifest.cases) {
  let out = ''
  try { out = runHeadless(c.task) } catch (e) { out = String(e.stdout ?? e.message) }
  const report = extractReportJson(out)
  const passed = c.graders.every((g) => grade(g, report))
  const budgetOk = (report._usage?.inputTokens ?? 0) <= (c.budget.maxInputTokens ?? Infinity)
  results.push({ id: c.id, passed, budgetOk })
  console.log((passed && budgetOk ? 'PASS' : 'FAIL') + ' ' + c.id)
}

const rate = results.filter((r) => r.passed && r.budgetOk).length / results.length
console.log('通过率（含预算门禁）: ' + (rate * 100).toFixed(1) + '%')
console.log('明细: ' + JSON.stringify(results, null, 2))
process.exit(rate >= 0.9 ? 0 : 1)
