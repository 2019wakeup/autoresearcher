import { useCallback, useEffect, useRef, useState } from 'react'
import { createTask, listTasks, subscribeLogs, TaskInfo } from './api'

export default function App() {
  const [taskInput, setTaskInput] = useState('')
  const [tasks, setTasks] = useState<TaskInfo[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [logs, setLogs] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const wsCleanup = useRef<(() => void) | null>(null)

  // 任务列表：5 秒轮询（企业版可换 SSE/WS 推送）
  const refresh = useCallback(async () => {
    try { setTasks(await listTasks()) } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])
  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 5000)
    return () => clearInterval(timer)
  }, [refresh])

  // 切换任务：订阅其日志流
  useEffect(() => {
    if (wsCleanup.current) { wsCleanup.current(); wsCleanup.current = null }
    setLogs('')
    setError(null)
    if (!currentId) return
    wsCleanup.current = subscribeLogs(currentId, (chunk) => {
      setLogs((prev) => (prev + chunk).slice(-200_000))
    })
    // 结果视图：完成后拉取结构化结果（/api/tasks/{id}/result）
    fetch('/api/tasks/' + currentId + '/result', { headers })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('result not ready'))))
      .then((data) => setResult(JSON.stringify(data, null, 2)))
      .catch(() => setResult(null))
    return () => { if (wsCleanup.current) { wsCleanup.current(); wsCleanup.current = null } }
  }, [currentId])

  const submit = async () => {
    if (!taskInput.trim()) return
    setError(null)
    try {
      const info = await createTask(taskInput)
      setCurrentId(info.taskId)
      setTaskInput('')
      refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div style={{ display: 'flex', gap: 24, padding: 24, fontFamily: 'sans-serif' }}>
      <div style={{ width: 340, flexShrink: 0 }}>
        <h1 style={{ fontSize: 20 }}>AutoResearcher</h1>
        <p style={{ fontSize: 12, color: '#666' }}>
          科研自动化 Agent：文献调研 / 实验运行 / 数据分析
        </p>
        <textarea
          value={taskInput}
          onChange={(e) => setTaskInput(e.target.value)}
          placeholder={'例如：检索 KV cache 优化论文，输出结构化清单'}
          style={{ width: '100%', height: 80, boxSizing: 'border-box' }}
        />
        <button onClick={submit} disabled={!taskInput.trim()}
                style={{ marginTop: 8, width: '100%', padding: 8 }}>
          创建科研任务
        </button>
        {error && <p style={{ color: 'red', fontSize: 12 }}>{error}</p>}
        <h2 style={{ fontSize: 14, marginTop: 16 }}>任务列表</h2>
        {tasks.length === 0 && <p style={{ fontSize: 12, color: '#999' }}>暂无任务</p>}
        {tasks.map((t) => (
          <div
            key={t.taskId}
            onClick={() => setCurrentId(t.taskId)}
            style={{
              cursor: 'pointer', padding: '6px 8px', marginBottom: 4,
              border: '1px solid #ddd', borderRadius: 4,
              background: t.taskId === currentId ? '#eef' : '#fff',
              fontSize: 13,
            }}
          >
            <strong>{t.taskId}</strong> · {t.status}
          </div>
        ))}
      </div>
      <div style={{ flex: 1 }}>
        <h2 style={{ fontSize: 14 }}>
          {currentId ? ('任务 ' + currentId + ' 日志') : '（选择左侧任务查看日志）'}
        </h2>
        <pre style={{
          height: 420, overflow: 'auto', background: '#111', color: '#0f0',
          padding: 12, borderRadius: 6, fontSize: 12, whiteSpace: 'pre-wrap',
        }}>
          {logs || '（暂无日志）'}
        </pre>
        <h2 style={{ fontSize: 14, marginTop: 12 }}>
          {currentId ? '结构化结果' : ''}
        </h2>
        {result && (
          <pre style={{
            height: 200, overflow: 'auto', background: '#f5f5f5',
            padding: 12, borderRadius: 6, fontSize: 12,
          }}>
            {result}
          </pre>
        )}
      </div>
    </div>
  )
}