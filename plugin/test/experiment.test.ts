import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { runExperimentScript, SCRIPTS_ROOT } from '../src/experiment.js'

// 准备一个临时白名单脚本
const ROOT = resolve('data/scripts')
beforeAll(() => {
  mkdirSync(ROOT, { recursive: true })
  writeFileSync(resolve(ROOT, 'demo.sh'),
    '#!/bin/bash\necho "hello from experiment"\nexit 0')
  writeFileSync(resolve(ROOT, 'slow.sh'),
    '#!/bin/bash\nsleep 30\necho "too slow"')
})
afterAll(() => {
  rmSync(resolve('data'), { recursive: true, force: true })
})

describe('run_experiment 工具', () => {
  it('白名单内脚本正常运行并返回日志', async () => {
    const out = await runExperimentScript('demo.sh', [], 10)
    expect(out.exitCode).toBe(0)
    expect(out.tail).toContain('hello from experiment')
    expect(out.logPath).toContain('data/logs/')
  })

  it('路径逃逸（../）被拒绝', async () => {
    await expect(runExperimentScript('../evil.sh', [], 5))
      .rejects.toThrow(/data\/scripts/)
  })

  it('超时强制杀死（timedOut=true）', async () => {
    const out = await runExperimentScript('slow.sh', [], 1)
    expect(out.timedOut).toBe(true)
    expect(out.exitCode).not.toBe(0)
  })
})
