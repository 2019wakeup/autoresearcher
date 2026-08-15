import { describe, it, expect } from 'vitest'
import { extractArxivId } from '../src/survey.js'

describe('literature_survey 辅助函数', () => {
  it('从 abs 链接提取 arXiv id', () => {
    expect(extractArxivId('https://arxiv.org/abs/2401.00001')).toBe('2401.00001')
  })
  it('从 pdf 链接（带版本号）提取', () => {
    expect(extractArxivId('https://arxiv.org/pdf/2401.00002v2')).toBe('2401.00002v2')
  })
  it('非 arXiv 链接返回 null', () => {
    expect(extractArxivId('https://example.com/paper')).toBeNull()
  })
})
