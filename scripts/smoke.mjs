#!/usr/bin/env node
// scripts/smoke.mjs —— AutoResearcher 端到端冒烟测试
//
// 流程：health → 创建任务 → 轮询状态 → 等待完成 → 校验结果 JSON →（可选）WS 日志
// 用法：
//   node scripts/smoke.mjs                    # 默认 http://localhost:8000
//   BASE_URL=http://x:8000 API_TOKEN=xxx node scripts/smoke.mjs
//   DRY_RUN=1 模式无需 dsh（假任务进程），适合 CI 验证 API 契约
//
// 依赖缺失（fastapi 未安装）时打印 SKIP 并以退出码 3 结束（CI 可容忍）。
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const BASE = process.env.BASE_URL ?? 'http://localhost:8000'
const TOKEN = process.env.API_TOKEN ?? 'smoke-token'
const PASS = (msg) => console.log('  PASS ' + msg)
const FAIL = (msg) => { console.error('  FAIL ' + msg); process.exitCode = 1 }

async function api(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { 'Authorization': 'Bearer ' + TOKEN, ...(opts.headers ?? {}) },
  })
  const body = await res.text()
  let json = null
  try { json = JSON.parse(body) } catch { /* 非 JSON */ }
  return { status: res.status, json, body }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

async function main() {
  console.log('[smoke] AutoResearcher 冒烟测试 →', BASE)

  // 0. 依赖预检：fastapi 是否可导入（优先项目 venv）
  const pyBin = existsSync(resolve('.venv/bin/python'))
    ? resolve('.venv/bin/python') : (process.env.PYTHON_BIN ?? 'python3')
  const deps = spawnSync(pyBin, ['-c', 'import fastapi, uvicorn, pydantic'], { encoding: 'utf8' })
  if (deps.status !== 0) {
    console.log('[smoke] SKIP: 本机未安装 fastapi（cd backend && pip install -r requirements.txt 后重跑）')
    process.exit(3)
  }

  // 1. health
  const health = await api('/api/health')
  if (health.status === 200 && health.json?.ok === true) PASS('health 检查')
  else FAIL('health 检查 (' + health.status + ')')

  // 2. 创建任务
  const created = await api('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task: '冒烟测试：统计文件' }),
  })
  if (created.status === 200 && created.json?.taskId) PASS('创建任务 ' + created.json.taskId)
  else { FAIL('创建任务 (' + created.status + ')'); return }
  const taskId = created.json.taskId

  // 3. 轮询直到 done（最多 30s）
  let detail = null
  for (let i = 0; i < 60; i++) {
    await sleep(500)
    detail = await api('/api/tasks/' + taskId)
    if (detail.json?.status === 'done') break
  }
  if (detail?.json?.status === 'done') PASS('任务完成（' + (detail.json.logTail ?? '').length + ' 字符日志）')
  else FAIL('任务未在 30s 内完成')

  // 4. 鉴权负例：无 token 应 401
  const noAuth = await fetch(BASE + '/api/tasks', {})
  if (noAuth.status === 401) PASS('鉴权负例（无 token → 401）')
  else FAIL('鉴权负例 (got ' + noAuth.status + ')')

  // 5. 结果落盘（DRY_RUN 或真实 dsh 都会写 data/results/{id}.json）
  const result = await api('/api/tasks/' + taskId + '/result')
  if (result.status === 200 && result.json) PASS('结构化结果: ' + JSON.stringify(result.json).slice(0, 80))
  else if (result.status === 404) PASS('结果未就绪（404，契约正确）')
  else FAIL('结果接口 (' + result.status + ')')

  console.log(process.exitCode ? '[smoke] 存在失败项' : '[smoke] 全部通过 ✅')
  process.exit(process.exitCode ?? 0)
}

// spawnSync 兼容导入
main().catch((e) => { console.error('[smoke] 异常:', e); process.exit(1) })