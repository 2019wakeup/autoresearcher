import { describe, it, expect, vi } from 'vitest'
import { searchArxiv } from '../src/arxiv.js'

const okRes = (xml: string) => ({
  ok: true,
  status: 200,
  text: async () => xml,
})

describe('arxiv_search 工具', () => {
  it('解析单个条目（entry 不是数组的边界）', async () => {
    const xml = '<feed><entry><title>  T1  </title>' +
      '<author><name>A</name></author>' +
      '<id>http://arxiv.org/abs/2401.0001</id>' +
      '<published>2024-01-01</published>' +
      '<summary>Sum</summary></entry></feed>'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okRes(xml)))
    const out = await searchArxiv('x', 1)
    expect(out.papers[0].title).toBe('T1')
    expect(out.papers[0].link).toContain('arxiv.org')
  })

  it('空结果返回空数组（不抛错）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okRes('<feed></feed>')))
    const out = await searchArxiv('nothing')
    expect(out.papers).toEqual([])
  })

  it('网络失败抛可读错误（模型可纠正）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, text: async () => '' }))
    await expect(searchArxiv('kv cache')).rejects.toThrow(/503/)
  })

  it('空查询直接拒绝（不发请求）', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(searchArxiv('  ')).rejects.toThrow(/query/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
