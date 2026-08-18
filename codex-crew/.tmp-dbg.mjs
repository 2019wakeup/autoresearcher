import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: 'node',
  args: [new URL('../mcp-server.mjs', import.meta.url).pathname],
  env: { ...process.env, DSH_API_TOKEN: 'test-token', DSH_API_BASE: 'http://localhost:8000' },
});
const client = new Client({ name: 'dbg', version: '0.1.0' });

async function main() {
  await client.connect(transport);
  const raw = await client.callTool({ name: 'dsh_health', arguments: {} });
  console.log('callTool 返回:', JSON.stringify(raw));
  await client.close();
}
main().catch((e) => { console.error('异常:', e); process.exit(1) });
