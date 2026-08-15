// 文献调研：检索 → 下载 PDF → 解析 → 结构化索引
// 设计：一次工具调用完成"调研首轮"，返回可精读的索引；
// 模型可据此选择论文，再用 parse_pdf 精读全文。
import { searchArxiv, ArxivPaper } from './arxiv.js'
import { extractPdfText } from './pdf.js'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

export interface SurveyPaper {
  title: string
  link: string
  localPath: string
  pages: number
  excerpt: string
}

export interface SurveyResult {
  papers: SurveyPaper[]
  total: number
}

const PAPERS_DIR = resolve('data/papers')
const EXCERPT_CHARS = 600

/** 下载 arXiv PDF（id 形如 2401.00001） */
async function downloadPdf(arxivId: string, destPath: string): Promise<void> {
  const url = 'https://arxiv.org/pdf/' + arxivId
  const res = await fetch(url)
  if (!res.ok) throw new Error('literature_survey: PDF 下载失败 ' + res.status + ' (' + arxivId + ')')
  const buf = Buffer.from(await res.arrayBuffer())
  writeFileSync(destPath, buf)
}

/** 从 arXiv 链接提取 id（支持 abs/xxx 与 pdf/xxx 两种形式） */
export function extractArxivId(link: string): string | null {
  const m = link.match(/arxiv\.org\/(?:abs|pdf)\/([0-9]{4}\.[0-9]{4,5}(?:v\d+)?)/)
  return m ? m[1] : null
}

/** 文献调研首轮：检索 + 下载 + 解析（前 3 页），返回索引 */
export async function literatureSurvey(query: string, maxPapers = 5): Promise<SurveyResult> {
  const found = await searchArxiv(query, maxPapers)
  mkdirSync(PAPERS_DIR, { recursive: true })

  const papers: SurveyPaper[] = []
  for (const p of found.papers) {
    const arxivId = extractArxivId(p.link)
    if (!arxivId) continue
    const localPath = resolve(PAPERS_DIR, arxivId.replace('/', '_') + '.pdf')
    try {
      if (!existsSync(localPath)) {
        await downloadPdf(arxivId, localPath)
      }
      const parsed = await extractPdfText(localPath, 3)
      papers.push({
        title: p.title,
        link: p.link,
        localPath,
        pages: parsed.pages,
        excerpt: parsed.text.replace(/\s+/g, ' ').trim().slice(0, EXCERPT_CHARS),
      })
    } catch (e) {
      // 单篇失败不拖垮整批：跳过并继续（模型会在结果里看到缺了哪篇）
      continue
    }
  }
  return { papers, total: papers.length }
}
