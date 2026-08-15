// arXiv 检索：export.arxiv.org/api/query（Atom XML）
// 纯逻辑模块：不依赖 cordis，便于单测
import { XMLParser } from 'fast-xml-parser'

export interface ArxivPaper {
  title: string
  authors: string[]
  summary: string
  link: string
  published: string
}

export interface ArxivSearchResult {
  papers: ArxivPaper[]
  total: number
}

/** 检索 arXiv；网络失败抛可读错误（模型可据此纠正）。 */
export async function searchArxiv(query: string, maxResults = 10): Promise<ArxivSearchResult> {
  if (!query || query.trim() === '') {
    throw new Error('arxiv_search: query 不能为空')
  }
  const q = encodeURIComponent('all:' + query.trim())
  const url = 'https://export.arxiv.org/api/query?search_query=' + q +
    '&start=0&max_results=' + Math.min(Math.max(maxResults, 1), 50)
  let res: Response
  try {
    res = await fetch(url)
  } catch (e) {
    throw new Error('arxiv_search: 网络请求失败: ' + (e instanceof Error ? e.message : String(e)))
  }
  if (!res.ok) {
    throw new Error('arxiv_search: arXiv API 返回 ' + res.status)
  }
  const xml = new XMLParser({ ignoreAttributes: false }).parse(await res.text())
  const entries = xml.feed?.entry ?? []
  const list = Array.isArray(entries) ? entries : [entries]
  const papers = list.map((e: Record<string, unknown>) => ({
    title: String(e.title ?? '').replace(/\s+/g, ' ').trim(),
    authors: (Array.isArray(e.author) ? e.author : [e.author])
      .map((a: Record<string, unknown>) => String(a.name ?? '')).filter(Boolean),
    summary: String(e.summary ?? '').replace(/\s+/g, ' ').trim().slice(0, 500),
    link: String(e.id ?? ''),
    published: String(e.published ?? ''),
  }))
  return { papers, total: papers.length }
}
