#!/usr/bin/env node
// scripts/setup-agent.mjs —— 一键装配 AutoResearcher Agent 到 DSH
//
// 流程：
//   1. 构建插件（tsc → dist/）
//   2. 把插件装入目标 DSH profile（dsh plugin --profile <P> add <plugin 目录>）
//   3. 把 agent/agent.cordis.yml 安装到 ~/.dsh/.agent-presets/autoresearcher/
//   4. 提示验证方式
//
// 用法：
//   node scripts/setup-agent.mjs                 # 默认 profile: autoresearcher
//   PROFILE=my-profile node scripts/setup-agent.mjs
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, copyFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve, join } from 'node:path'

const PROFILE = process.env.PROFILE ?? 'autoresearcher'
const ROOT = resolve(process.cwd())
const PRESET_SRC = join(ROOT, 'agent', 'agent.cordis.yml')
const PRESET_DIR = join(homedir(), '.dsh', '.agent-presets', PROFILE)

function run(cmd) {
  console.log('$ ' + cmd)
  execSync(cmd, { stdio: 'inherit', cwd: ROOT })
}

function main() {
  // 1. 构建插件
  if (!existsSync(join(ROOT, 'plugin', 'node_modules'))) {
    console.log('[setup] 先安装插件依赖…')
    run('cd plugin && npm install')
  }
  console.log('[setup] 构建插件…')
  run('cd plugin && npm run build')

  // 2. 装入 profile（目标 profile 不存在时自动创建）
  console.log('[setup] 把插件装入 profile: ' + PROFILE)
  run('dsh plugin --profile ' + PROFILE + ' add ' + join(ROOT, 'plugin'))

  // 3. 安装预设
  console.log('[setup] 安装预设到 ' + PRESET_DIR)
  mkdirSync(PRESET_DIR, { recursive: true })
  copyFileSync(PRESET_SRC, join(PRESET_DIR, 'agent.cordis.yml'))

  console.log('')
  console.log('[setup] 完成！下一步：')
  console.log('  1) 验证：dsh --profile ' + PROFILE + ' --dump-config | head')
  console.log('  2) 跑评测（需 DEEPSEEK_API_KEY）：')
  console.log('     DSH_PROFILE=' + PROFILE + ' DEEPSEEK_API_KEY=xxx node evals/run-evals.mjs')
  console.log('  3) 用后端建任务时指定 profile：')
  console.log("     curl -X POST /api/tasks -d '{\"task\":\"...\",\"profile\":\"" + PROFILE + "\"}'")
}

main()