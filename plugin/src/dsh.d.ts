// dsh.d.ts —— 独立运行时的类型增强
// 说明：完整 DSH 环境下由 @deepseek-ai/dsh-tools 提供这些类型；
// 本文件让插件在"仅安装 cordis"时也能通过 tsc 检查（松类型，见下）。
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** 工具注册表（完整类型来自 dsh-tools；此处最小化声明） */
    tools: {
      register(def: Record<string, unknown>): void
    }
  }
}

declare module 'pdf-parse' {
  interface PdfParseResult {
    text: string
    numpages: number
    info: Record<string, unknown>
  }
  function parse(data: Buffer): Promise<PdfParseResult>
  export = parse
}
