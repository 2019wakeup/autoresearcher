// PDF 文本提取：前 N 页，输出截断保护
import { readFileSync } from 'node:fs'

export interface PdfResult {
  text: string
  pages: number
  truncated: boolean
}

export function extractPdfText(path: string, maxPages = 10): PdfResult {
  // 动态导入 pdf-parse（可选依赖，构建时不会强依赖）
  return import('pdf-parse').then((mod) => {
    const parse = mod.default
    return new Promise((resolveResult, reject) => {
      const buf = readFileSync(path)
      parse(buf).then((data: { text: string; numpages: number }) => {
        const pages = Math.min(data.numpages, Math.max(maxPages, 1))
        const full = data.text.slice(0, 200_000)
        const lines = full.split('\n')
        // 按页数截断（简化：每页约 60 行文本）
        const sliced = lines.slice(0, pages * 60).join('\n')
        resolveResult({
          text: sliced,
          pages,
          truncated: sliced.length < full.length,
        })
      }).catch((e: unknown) => reject(new Error('parse_pdf: 解析失败: ' + String(e))))
    })
  })
}
