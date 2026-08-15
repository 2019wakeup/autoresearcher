// PDF 文本提取：前 N 页，输出截断保护
import { readFileSync } from 'node:fs'
import parse from 'pdf-parse'

export interface PdfResult {
  text: string
  pages: number
  truncated: boolean
}

export async function extractPdfText(path: string, maxPages = 10): Promise<PdfResult> {
  const buf = readFileSync(path)
  const data = await parse(buf)
  const pages = Math.min(data.numpages, Math.max(maxPages, 1))
  const full = data.text.slice(0, 200_000)
  const lines = full.split('\n')
  // 按页数截断（简化：每页约 60 行文本）
  const sliced = lines.slice(0, pages * 60).join('\n')
  return {
    text: sliced,
    pages,
    truncated: sliced.length < full.length,
  }
}
