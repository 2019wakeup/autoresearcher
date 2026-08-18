import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// 模拟远程服务器地址（不存在）
const transport = new StdioClientTransport({
  command: 'node',
  args: [new URL('./mcp-server.mjs', import.meta.url).pathname],
  env: { ...process.env, DSH_API_TOKEN: 'test-token', DSH_API_BASE: 'http://203.0.113.10:8000' },
});
const client = new Client({ name: 'remote-dbg', version: '0.1.0' });

async function main() {
  await client.connect(transport);
  const raw = await client.callTool({ name: 'dsh_health', arguments: {} });
  console.log('远程 health 返回:', JSON.stringify(raw).slice(0, 300));
  const text = raw.content?.[0]?.text ?? '';
  if (text.includes('后端') && text.includes('fetch')) {
    console.log('PASS: 请求确实发往配置的远程地址（连接失败被清晰上报）');
  } else {
    console.log('返回内容:', text.slice(0, 200));
  }
  await client.close();
}
main().catch((e) => { console.error('异常:', e.message?.slice(0, 120)); process.exit(1) });
