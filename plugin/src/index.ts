// AutoResearcher 科研工具插件（Cordis 插件）
// 在 DSH 的 agent 预设组合中注册为一行：- id: research-tools, name: '@autoresearcher/plugin-research'
import { Context } from '@deepseek-ai/cordis'
import { searchArxiv } from './arxiv.js'
import { runExperimentScript } from './experiment.js'
import { extractPdfText } from './pdf.js'
import { literatureSurvey } from './survey.js'

export const name = '@autoresearcher/plugin-research'

export function apply(ctx: Context): void {
  // 工具 1：arxiv 文献检索
  ctx.tools.register({
    name: 'arxiv_search',
    description: '检索 arXiv 论文，返回结构化清单（标题/作者/摘要/链接）。文献调研第一步。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: '检索词，如 KV cache optimization（英文）' },
        maxResults: { type: 'integer', description: '返回条数 1-50，默认 10', default: 10 },
      },
      required: ['query'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          papers: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                title: { type: 'string', required: true },
                authors: { type: 'array', required: true, items: { type: 'string' } },
                summary: { type: 'string', required: true },
                link: { type: 'string', required: true },
                published: { type: 'string', required: true },
              },
            },
          },
          total: { type: 'integer', required: true },
        },
      },
    },
    async execute(args: { query: string; maxResults?: number }) {
      return searchArxiv(args.query, args.maxResults ?? 10)
    },
  })

  // 工具 2：受控实验运行
  ctx.tools.register({
    name: 'run_experiment',
    description: '在沙箱内运行白名单实验脚本（data/scripts/ 下），返回退出码/日志尾部/日志路径。运行实验需要审批。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        script: { type: 'string', description: '脚本相对路径，如 data/scripts/train_mnist.sh' },
        args: { type: 'array', items: { type: 'string' }, description: '脚本参数' },
        timeoutSec: { type: 'integer', description: '超时秒数，默认 600', default: 600 },
      },
      required: ['script'],
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          exitCode: { type: 'integer', required: true },
          tail: { type: 'string', required: true },
          logPath: { type: 'string', required: true },
          timedOut: { type: 'boolean', required: true },
        },
      },
    },
    async execute(args: { script: string; args?: string[]; timeoutSec?: number }) {
      return runExperimentScript(args.script, args.args ?? [], args.timeoutSec ?? 600)
    },
  })

  // 工具 3：PDF 解析（论文精读）
  ctx.tools.register({
    name: 'parse_pdf',
    description: '解析 PDF 文本（前 N 页），用于精读论文。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: { type: 'string', description: 'PDF 文件路径' },
        maxPages: { type: 'integer', description: '最大解析页数，默认 10', default: 10 },
      },
      required: ['path'],
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          text: { type: 'string', required: true },
          pages: { type: 'integer', required: true },
          truncated: { type: 'boolean', required: true },
        },
      },
    },
    async execute(args: { path: string; maxPages?: number }) {
      return extractPdfText(args.path, args.maxPages ?? 10)
    },
  })

  // 工具 4：文献调研（检索 → 下载 PDF → 解析 → 结构化索引）
  ctx.tools.register({
    name: 'literature_survey',
    description: '文献调研首轮：检索 arXiv、下载 PDF 到 data/papers/、解析前几页，返回可精读的结构化索引。随后可用 parse_pdf 精读。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: '检索词，如 KV cache optimization（英文）' },
        maxPapers: { type: 'integer', description: '下载并解析的最大论文数 1-10，默认 5', default: 5 },
      },
      required: ['query'],
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          papers: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                title: { type: 'string', required: true },
                link: { type: 'string', required: true },
                localPath: { type: 'string', required: true },
                pages: { type: 'integer', required: true },
                excerpt: { type: 'string', required: true },
              },
            },
          },
          total: { type: 'integer', required: true },
        },
      },
    },
    async execute(args: { query: string; maxPapers?: number }) {
      return literatureSurvey(args.query, args.maxPapers ?? 5)
    },
  })
}