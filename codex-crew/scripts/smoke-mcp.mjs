#!/usr/bin/env node
// codex-crew/scripts/smoke-mcp.mjs —— MCP 端到端冒烟（无需真实 dsh）
// 前置：后端 DRY_RUN=1 API_TOKEN=test-token 运行中；本目录已 npm i @modelcontextprotocol/sdk zod
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const PASS = (m) => console.log('  PASS ' + m);
const FAIL = (m) => { console.error('  FAIL ' + m); process.exitCode = 1 };

const transport = new StdioClientTransport({
  command: 'node',
  args: [new URL('../mcp-server.mjs', import.meta.url).pathname],
  env: { ...process.env, DSH_API_TOKEN: 'test-token', DSH_API_BASE: 'http://localhost:8000' },
});
const client = new Client({ name: 'smoke', version: '0.1.0' });

async function main() {
  await client.connect(transport);
  console.log('[smoke-mcp] MCP 已连接');

  const health = JSON.parse((await client.callTool({ name: 'dsh_health', arguments: {} })).content[0].text);
  health.ok ? PASS('dsh_health（后端可达）') : FAIL('dsh_health');

  const run = JSON.parse((await client.callTool({
    name: 'dsh_run_task',
    arguments: { task: '冒烟：统计文件', tier: 'flash', timeout_seconds: 60 },
  })).content[0].text);
  if (run.status === 'done') {
    PASS('dsh_run_task 完成 taskId=' + run.taskId);
    (run.result && run.result.ok === true) ? PASS('结构化结果: ' + JSON.stringify(run.result).slice(0, 60)) : FAIL('结构化结果缺失');
  } else {
    FAIL('dsh_run_task status=' + run.status + ' log=' + (run.logTail ?? '').slice(-100));
  }

  const st = JSON.parse((await client.callTool({ name: 'dsh_task_status', arguments: { task_id: run.taskId } })).content[0].text);
  st.status ? PASS('dsh_task_status status=' + st.status) : FAIL('dsh_task_status');

  await client.close();
  console.log(process.exitCode ? '[smoke-mcp] 存在失败项' : '[smoke-mcp] 全部通过 ✅');
  process.exit(process.exitCode ?? 0);
}
main().catch((e) => { console.error('[smoke-mcp] 异常:', e); process.exit(1) });
