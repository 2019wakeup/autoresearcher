// 实验资源治理：预算账本 + 熔断决策 + GPU/磁盘预检
// 设计：
//   - 纯逻辑与 I/O 分离：decide()/parseGpuLine() 可单测
//   - 账本持久化到 data/ledger.json（跨进程累计，审计可查）
//   - 硬限制触发熔断（reject 实验），软警告仅记录
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

export interface Ledger {
  date: string          // YYYY-MM-DD，按天滚动
  experiments: number   // 当日已运行实验数
  runtimeSec: number    // 当日累计运行秒数
}

export interface ResourceLimits {
  maxExperimentsPerDay: number   // 当日实验数上限
  maxRuntimeSecPerDay: number    // 当日累计运行时长上限（秒）
  minFreeDiskMb: number          // 实验前磁盘最小剩余（MB）
  minFreeGpuMb: number           // 实验前 GPU 最小剩余（MB，0 表示不检查）
}

export const DEFAULT_LIMITS: ResourceLimits = {
  maxExperimentsPerDay: 50,
  maxRuntimeSecPerDay: 4 * 3600,
  minFreeDiskMb: 2048,
  minFreeGpuMb: 0,
}

export const LEDGER_PATH = resolve('data/ledger.json')

/** 今天的日期字符串（本地时区 YYYY-MM-DD） */
export function today(): string {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return d.getFullYear() + '-' + mm + '-' + dd
}

/** 读取账本（不存在或损坏时重置） */
export function loadLedger(path = LEDGER_PATH): Ledger {
  try {
    if (existsSync(path)) {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as Ledger
      if (raw && typeof raw.experiments === 'number' && raw.date) {
        // 跨天自动滚动
        if (raw.date !== today()) return { date: today(), experiments: 0, runtimeSec: 0 }
        return raw
      }
    }
  } catch {
    /* 损坏则重置 */
  }
  return { date: today(), experiments: 0, runtimeSec: 0 }
}

/** 保存账本（原子性：先写临时文件再改名） */
export function saveLedger(ledger: Ledger, path = LEDGER_PATH): void {
  mkdirSync(resolve(path, '..'), { recursive: true })
  const tmp = path + '.tmp'
  writeFileSync(tmp, JSON.stringify(ledger, null, 2), 'utf8')
  // 简单替换（生产可用 fs.renameSync 原子改名）
  const { renameSync } = require('node:fs') as typeof import('node:fs')
  renameSync(tmp, path)
}

/** 熔断决策：纯函数，便于单测 */
export function decide(
  ledger: Ledger,
  limits: ResourceLimits,
  preflight: { freeDiskMb?: number; freeGpuMb?: number } = {},
): { allowed: boolean; reason?: string } {
  if (ledger.experiments >= limits.maxExperimentsPerDay) {
    return { allowed: false, reason: '当日实验数已达上限 ' + limits.maxExperimentsPerDay }
  }
  if (ledger.runtimeSec >= limits.maxRuntimeSecPerDay) {
    return { allowed: false, reason: '当日累计运行时长已达上限 ' + Math.round(limits.maxRuntimeSecPerDay / 60) + ' 分钟' }
  }
  if (limits.minFreeDiskMb > 0 && (preflight.freeDiskMb ?? Infinity) < limits.minFreeDiskMb) {
    return { allowed: false, reason: '磁盘剩余不足（需 ≥ ' + limits.minFreeDiskMb + ' MB）' }
  }
  if (limits.minFreeGpuMb > 0 && (preflight.freeGpuMb ?? Infinity) < limits.minFreeGpuMb) {
    return { allowed: false, reason: 'GPU 显存剩余不足（需 ≥ ' + limits.minFreeGpuMb + ' MB）' }
  }
  return { allowed: true }
}

/** 解析 nvidia-smi 输出行："1234 / 24576 MiB" → 1234 */
export function parseGpuLine(line: string): number | null {
  const m = line.match(/(\d+)\s*\/\s*(\d+)/)
  if (!m) return null
  return Number(m[1])
}

/** 磁盘剩余（MB）：df -Pk 输出 "Filesystem 1024-blocks Used Available ..." */
export function parseDfLine(line: string): number | null {
  const parts = line.trim().split(/\s+/)
  if (parts.length < 4) return null
  const availKb = Number(parts[3])
  if (!Number.isFinite(availKb)) return null
  return Math.floor(availKb / 1024)
}

/** 预检 GPU 剩余显存（MB）；nvidia-smi 不可用时返回 null（跳过检查） */
export function probeFreeGpuMb(): number | null {
  try {
    const { execSync } = require('node:child_process') as typeof import('node:child_process')
    const out = execSync(
      'nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader,nounits',
      { encoding: 'utf8', timeout: 5000 },
    )
    let minFree: number | null = null
    for (const line of out.trim().split('\n')) {
      const m = line.match(/(\d+),\s*(\d+)/)
      if (!m) continue
      const free = Number(m[2]) - Number(m[1])
      if (minFree === null || free < minFree) minFree = free
    }
    return minFree
  } catch {
    return null   // 无 GPU/无 nvidia-smi：不阻塞实验，仅警告
  }
}

/** 预检磁盘剩余（MB）；失败返回 null */
export function probeFreeDiskMb(dir = 'data'): number | null {
  try {
    const { execSync } = require('node:child_process') as typeof import('node:child_process')
    const out = execSync('df -Pk ' + dir, { encoding: 'utf8', timeout: 5000 })
    const lines = out.trim().split('\n')
    return parseDfLine(lines[lines.length - 1] ?? '')
  } catch {
    return null
  }
}
