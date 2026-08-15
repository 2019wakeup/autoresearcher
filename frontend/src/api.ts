// API 客户端：前端与后端唯一的交互通道（前后端分离的契约实现）
const TOKEN = import.meta.env.VITE_API_TOKEN ?? ''

const headers = {
  'Content-Type': 'application/json',
  'Authorization': 'Bearer ' + TOKEN,
}

export interface TaskInfo {
  taskId: string
  status: string
  createdAt: number
}

export interface TaskDetail {
  taskId: string
  status: string
  logTail: string
}

export async function createTask(task: string): Promise<TaskInfo> {
  const res = await fetch('/api/tasks', {
    method: 'POST',
    headers,
    body: JSON.stringify({ task }),
  })
  if (!res.ok) throw new Error('创建任务失败: ' + res.status)
  return res.json()
}

export async function listTasks(): Promise<TaskInfo[]> {
  const res = await fetch('/api/tasks', { headers })
  if (!res.ok) throw new Error('获取任务列表失败: ' + res.status)
  return res.json()
}

export async function getTask(taskId: string): Promise<TaskDetail> {
  const res = await fetch('/api/tasks/' + taskId, { headers })
  if (!res.ok) throw new Error('获取任务失败: ' + res.status)
  return res.json()
}

/** 订阅任务日志流（WebSocket）；返回关闭函数。 */
/** 订阅任务日志流：自动断线重连（指数退避）+ 心跳超时检测。 */
export function subscribeLogs(taskId: string, onData: (text: string) => void): () => void {
  const proto = location.protocol === 'https:' ? 'wss://' : 'ws://'
  const wsUrl = proto + location.host + '/api/ws/' + taskId +
    (TOKEN ? '?token=' + encodeURIComponent(TOKEN) : '')
  let ws: WebSocket | null = null
  let closed = false
  let retry = 0
  let lastBeat = Date.now()

  const connect = () => {
    if (closed) return
    ws = new WebSocket(wsUrl)
    ws.onopen = () => { retry = 0; lastBeat = Date.now() }
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.type === 'ping') lastBeat = Date.now()
        else if (msg.type === 'log' && msg.data) onData(msg.data)
        else if (msg.type === 'status' && msg.data === 'done') { close(); return }
      } catch {
        /* 忽略非 JSON 帧 */
      }
    }
    ws.onclose = () => {
      if (closed) return
      // 指数退避重连：1s → 2s → 4s → ... → 30s 封顶
      const delay = Math.min(1000 * Math.pow(2, retry), 30000)
      retry += 1
      setTimeout(connect, delay)
    }
  }

  // 心跳超时检测：45s 无任何帧则强制重连
  const beatTimer = setInterval(() => {
    if (!closed && Date.now() - lastBeat > 45000 && ws) {
      try { ws.close() } catch { /* 已断开 */ }
    }
  }, 10000)

  const close = () => { closed = true; clearInterval(beatTimer); if (ws) ws.close() }
  connect()
  return close
}