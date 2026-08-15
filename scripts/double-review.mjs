#!/usr/bin/env node
// scripts/double-review.mjs —— 多 Agent 双评审编排器（发现者 + 复核者）
//
// 用法：
//   DEEPSEEK_API_KEY=xxx node scripts/double-review.mjs "审查这段代码：..."
//
// 流程：
//   1. 发现者（discoverer）：独立 headless 会话，产出结构化发现清单
//   2. 复核者（reviewer）：独立 headless 会话，只评审"发现者"的输出（找误报/漏报/补充分级）
//   3. 合并：两个结果合成一份最终报告，写入 data/results/double-review-<ts>.json
//
// 设计要点：
//   - 两个子代理完全隔离（各自独立的 DSH 会话），互不污染上下文
//   - 复核者只看到发现者的输出，防止"自说自话"
//   - 纯逻辑见 review-lib.mjs（可独立测试）
import { execFile } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { extractJson, merge, discovererPrompt, reviewerPrompt } from './review-lib.mjs'

const DSH_BIN = process.env.DSH_BIN ?? 'dsh'
const PROFILE = process.env.DSH_PROFILE ?? 'headless'

/** 跑一个隔离的 headless 会话，返回 stdout（非零退出也返回可用输出） */
function runAgent(prompt) {
  return new Promise((resolveResult) => {
    execFile(DSH_BIN, ['--profile', PROFILE, prompt], {
      encoding: 'utf8', timeout: 120_000, maxBuffer: 16 * 1024 * 1024,
    }, (err, stdout) => {
      resolveResult(stdout ?? String(err?.message ?? 'no output'))
    })
  })
}

async function main() {
  const task = process.argv[2]
  if (!task) {
    console.error('用法: node scripts/double-review.mjs "任务描述"')
    process.exit(2)
  }

  console.log('[double-review] 阶段 1/2：发现者运行中…')
  const discover = extractJson(await runAgent(discovererPrompt(task)))
  console.log('[double-review] 发现者产出 issues:', (discover.issues ?? []).length)

  console.log('[double-review] 阶段 2/2：复核者运行中…')
  const review = extractJson(await runAgent(reviewerPrompt(task, JSON.stringify(discover))))
  console.log('[double-review] 复核者误报:', (review.falsePositives ?? []).length,
    '漏报:', (review.missed ?? []).length, '结论:', review.verdict)

  const report = merge(discover, review, task)
  mkdirSync(resolve('data/results'), { recursive: true })
  const path = resolve('data/results/double-review-' + Date.now() + '.json')
  writeFileSync(path, JSON.stringify(report, null, 2), 'utf8')
  console.log('[double-review] 完成 →', path)
  console.log(JSON.stringify(report, null, 2))
}

main().catch((e) => { console.error('[double-review] 失败:', e); process.exit(1) })
