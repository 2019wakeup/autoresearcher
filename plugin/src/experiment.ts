// 实验运行器：科研 Agent 最危险的工具，三条铁律
//   1. 脚本必须在白名单目录内（防任意命令与路径逃逸）
//   2. 强制超时并 SIGKILL 进程（防实验失控）
//   3. 日志全量落盘（审计 + 可复现）
import { spawn } from 'node:child_process'
import { resolve, relative } from 'node:path'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import {
  DEFAULT_LIMITS, ResourceLimits, Ledger, decide, loadLedger, saveLedger,
  probeFreeDiskMb, probeFreeGpuMb,
} from './resource.js'

export interface ExperimentResult {
  exitCode: number
  tail: string
  logPath: string
  timedOut: boolean
}

// 白名单根目录：只有这里的脚本可以运行
export const SCRIPTS_ROOT = resolve('data/scripts')
const LOG_DIR = resolve('data/logs')
const MAX_TAIL = 4000

/** 运行白名单实验脚本；任何违规立即抛错（不进 shell）。 */
export function runExperimentScript(
  script: string,
  args: string[] = [],
  timeoutSec = 600,
  limits: ResourceLimits = DEFAULT_LIMITS,
): Promise<ExperimentResult> {
  const full = resolve(SCRIPTS_ROOT, script)
  // 铁律 1：路径必须在白名单根内
  const rel = relative(SCRIPTS_ROOT, full)
  if (rel.startsWith('..') || full !== resolve(SCRIPTS_ROOT, rel)) {
    return Promise.reject(new Error(
      'run_experiment: 脚本必须在 data/scripts/ 下（拒绝: ' + script + '）'))
  }
  if (!existsSync(full)) {
    return Promise.reject(new Error('run_experiment: 脚本不存在: ' + script))
  }

  // ── 资源熔断：预算账本 + GPU/磁盘预检（科研场景硬约束） ──
  const ledger = loadLedger()
  const preflight = {
    freeDiskMb: probeFreeDiskMb() ?? undefined,
    freeGpuMb: probeFreeGpuMb() ?? undefined,
  }
  const verdict = decide(ledger, limits, preflight)
  if (!verdict.allowed) {
    return Promise.reject(new Error('run_experiment: 资源熔断: ' + (verdict.reason ?? '未知原因')))
  }

  // 铁律 3：日志落盘（先建目录）
  mkdirSync(LOG_DIR, { recursive: true })
  const logPath = resolve(LOG_DIR, 'exp-' + Date.now() + '.log')

  return new Promise((resolveResult, reject) => {
    let child
    const startedAt = Date.now()
    try {
      child = spawn('bash', [full, ...args], {
        cwd: SCRIPTS_ROOT,
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
      })
    } catch (e) {
      reject(new Error('run_experiment: 启动失败: ' + String(e)))
      return
    }

    const chunks: Buffer[] = []
    child.stdout.on('data', (d: Buffer) => chunks.push(d))
    child.stderr.on('data', (d: Buffer) => chunks.push(d))

    // 铁律 2：超时杀进程
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch { /* 已退出 */ }
    }, Math.max(timeoutSec, 1) * 1000)

    child.on('error', (err) => {
      clearTimeout(timer)
      reject(new Error('run_experiment: 进程错误: ' + err.message))
    })

    child.on('exit', (code) => {
      clearTimeout(timer)
      // 记账：实验数 +1，运行时长累计（按超时上限估算实际运行时间）
      const elapsed = Math.min(timeoutSec, Date.now() - startedAt)
      ledger.experiments += 1
      ledger.runtimeSec += Math.floor(elapsed / 1000)
      saveLedger(ledger)
      const output = Buffer.concat(chunks).toString('utf8')
      try { writeFileSync(logPath, output) } catch (e) {
        reject(new Error('run_experiment: 日志落盘失败: ' + String(e)))
        return
      }
      resolveResult({
        exitCode: code ?? -1,
        tail: output.slice(-MAX_TAIL),
        logPath,
        timedOut: code === null,   // 被信号杀死时 code 为 null
      })
    })
  })
}