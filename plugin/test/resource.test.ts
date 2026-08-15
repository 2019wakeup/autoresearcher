import { describe, it, expect } from 'vitest'
import {
  decide, loadLedger, saveLedger, today, parseGpuLine, parseDfLine,
  DEFAULT_LIMITS, Ledger,
} from '../src/resource.js'
import { mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const TMP = resolve('.tmp-ledger-test')
const ledgerPath = resolve(TMP, 'ledger.json')

afterAll(() => rmSync(TMP, { recursive: true, force: true }))

describe('熔断决策 decide（纯函数）', () => {
  const base: Ledger = { date: today(), experiments: 0, runtimeSec: 0 }

  it('预算充足时放行', () => {
    expect(decide(base, DEFAULT_LIMITS).allowed).toBe(true)
  })

  it('实验数达上限时熔断', () => {
    const full = { ...base, experiments: DEFAULT_LIMITS.maxExperimentsPerDay }
    const v = decide(full, DEFAULT_LIMITS)
    expect(v.allowed).toBe(false)
    expect(v.reason).toContain('实验数')
  })

  it('运行时长达上限时熔断', () => {
    const full = { ...base, runtimeSec: DEFAULT_LIMITS.maxRuntimeSecPerDay }
    expect(decide(full, DEFAULT_LIMITS).allowed).toBe(false)
  })

  it('磁盘不足时熔断', () => {
    const v = decide(base, DEFAULT_LIMITS, { freeDiskMb: 100 })
    expect(v.allowed).toBe(false)
    expect(v.reason).toContain('磁盘')
  })

  it('GPU 显存不足时熔断', () => {
    const v = decide(base, { ...DEFAULT_LIMITS, minFreeGpuMb: 2048 }, { freeGpuMb: 512 })
    expect(v.allowed).toBe(false)
  })
})

describe('账本读写与跨天滚动', () => {
  it('不存在时返回空账本', () => {
    const l = loadLedger(ledgerPath)
    expect(l.experiments).toBe(0)
    expect(l.date).toBe(today())
  })

  it('保存后可读回', () => {
    saveLedger({ date: today(), experiments: 3, runtimeSec: 42 }, ledgerPath)
    const l = loadLedger(ledgerPath)
    expect(l.experiments).toBe(3)
    expect(l.runtimeSec).toBe(42)
  })

  it('损坏文件重置为空账本', () => {
    mkdirSync(TMP, { recursive: true })
    const { writeFileSync } = require('node:fs') as typeof import('node:fs')
    writeFileSync(ledgerPath, '{broken json', 'utf8')
    const l = loadLedger(ledgerPath)
    expect(l.experiments).toBe(0)
  })

  it('跨天自动滚动（伪造昨天的账本）', () => {
    const d = new Date(Date.now() - 86400000)
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    const yesterday = d.getFullYear() + '-' + mm + '-' + dd
    saveLedger({ date: yesterday, experiments: 999, runtimeSec: 9999 }, ledgerPath)
    const l = loadLedger(ledgerPath)
    expect(l.experiments).toBe(0)   // 新的一天，配额重置
    expect(l.date).toBe(today())
  })
})

describe('解析函数', () => {
  it('解析 nvidia-smi 行（used/total）', () => {
    expect(parseGpuLine('1234 / 24576 MiB')).toBe(1234)
    expect(parseGpuLine('  512MiB / 8192MiB')).toBe(512)
  })

  it('无法解析时返回 null', () => {
    expect(parseGpuLine('no gpu here')).toBeNull()
  })

  it('解析 df 行（Available 列，MB）', () => {
    // "Filesystem 1024-blocks Used Available Capacity Mounted"
    // Available=5242880 KB → 5120 MB
    expect(parseDfLine('/dev/sda1 123456 234567 5242880 10% /data')).toBe(5120)
  })
})
