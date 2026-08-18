#!/usr/bin/env node
// codex-crew/mcp-server.mjs —— Codex → AutoResearcher 的 MCP 桥
//
// 思路（见 docs/DSH-CREW-REPORT.md 方案 B）：dsh-crew 的 standalone 路径等价于
// "常驻调度层 + 按请求拉起 DSH worker"；我们的 FastAPI 后端就是这个调度层。
// 本 server 只做薄桥：把 MCP 工具调用转成后端的 REST 调用。
//
// 配置（环境变量）：
//   DSH_API_BASE   后端地址，默认 http://localhost:8000
//   DSH_API_TOKEN  后端 Bearer token（必填）
//   PROFILE_FLASH  tier=flash 用的 DSH profile，默认 autoresearcher
//   PROFILE_PRO    tier=pro 用的 DSH profile，默认 autoresearcher（预留旗舰预设）
//
// 用法：
//   DSH_API_TOKEN=xxx node codex-crew/mcp-server.mjs
//   然后在 Codex agent 定义里挂载本 server（见 codex-agent/ 目录）
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const API_BASE = process.env.DSH_API_BASE ?? 'http://localhost:8000';
const API_TOKEN = process.env.DSH_API_TOKEN;
const PROFILE_FLASH = process.env.PROFILE_FLASH ?? 'autoresearcher';
const PROFILE_PRO = process.env.PROFILE_PRO ?? 'autoresearcher';

if (!API_TOKEN) {
  console.error('codex-crew: 缺少 DSH_API_TOKEN（后端 Bearer token）');
  process.exit(2);
}

const server = new McpServer({ name: 'codex-crew', version: '0.1.0' });

// ── 后端 REST 封装 ──
async function api(path, opts = {}) {
  const res = await fetch(API_BASE + path, {
    ...opts,
    headers: { 'Authorization': 'Bearer ' + API_TOKEN, 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
  });
  const body = await res.text();
  let json = null;
  try { json = JSON.parse(body) } catch { /* 非 JSON */ }
  if (!res.ok) throw new Error('后端 ' + res.status + ': ' + (json?.detail ?? body.slice(0, 200)));
  return json;
}

function profileFor(tier) {
  return tier === 'pro' ? PROFILE_PRO : PROFILE_FLASH;
}

// ── MCP 工具 1：派发（阻塞等待完成） ──
server.registerTool('dsh_run_task', {
  title: 'Run DSH research task (blocking)',
  description: '把任务派给 AutoResearcher 的 DSH agent 并等待完成。tier=flash 用性价比模型（默认），tier=pro 用旗舰档。返回结构化结果。',
  inputSchema: {
    task: z.string().describe('自包含的任务描述'),
    tier: z.enum(['flash', 'pro']).optional().describe('模型档位，默认 flash'),
    cwd: z.string().optional().describe('工作目录（传递给 worker）'),
    timeout_seconds: z.number().int().positive().max(3600).optional(),
  },
}, async ({ task, tier, cwd, timeout_seconds }) => {
  const t = tier ?? 'flash';
  const created = await api('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ task: task, profile: profileFor(t) }),
  });
  const taskId = created.taskId;
  const timeout = timeout_seconds ?? 600;

  // 轮询直到完成（与后端契约一致：GET /api/tasks/{id} → status）
  const deadline = Date.now() + timeout * 1000;
  let detail = null;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    detail = await api('/api/tasks/' + taskId);
    if (detail.status === 'done' || detail.status === 'interrupted') break;
  }

  // 尝试拿结构化结果
  let result = null;
  try { result = await api('/api/tasks/' + taskId + '/result') } catch { /* 结果未就绪 */ }

  return {
    taskId: taskId,
    status: detail?.status ?? 'unknown',
    tier: t,
    logTail: detail?.logTail?.slice(-1500) ?? '',
    result: result,
  };
});

// ── MCP 工具 2：查询 ──
server.registerTool('dsh_task_status', {
  title: 'DSH task status',
  description: '查询任务状态与日志尾部',
  inputSchema: { task_id: z.string() },
}, async ({ task_id }) => {
  return api('/api/tasks/' + task_id);
});

// ── MCP 工具 3：健康检查 ──
server.registerTool('dsh_health', {
  title: 'AutoResearcher health',
  description: '检查 AutoResearcher 后端是否可用',
  inputSchema: {},
}, async () => {
  return api('/api/health');
});

await server.connect(new StdioServerTransport());
