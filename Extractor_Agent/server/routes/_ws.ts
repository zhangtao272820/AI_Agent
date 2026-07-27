import { useRuntimeConfig } from '#imports'
import { executeExtractRun } from '../utils/crawl_run'
import { buildCrawlerAgentResult } from '../utils/agent_result'
import { appendAgentTraceLog } from '../utils/trace_log'
import type { CrawlerAgentOptions } from '../services/crawlerAgentTypes'

function safeParseJson(text: string) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

type ClientMessage =
  | {
      type: 'start'
      payload: {
        task: string
        mode?: 'crawler' | 'manager'
        options?: CrawlerAgentOptions
        manager_task_json?: string
        session_id?: string
        trace_id?: string
        network?: boolean
        history?: Array<{ role: string; content: string }>
      }
    }
  | { type: 'cancel' }
  | { type: 'ping' }

const active = new Map<string, AbortController>()

export default defineWebSocketHandler({
  open(peer) {
    try {
      peer.send(JSON.stringify({ type: 'status', payload: 'open' }))
    } catch {}
  },
  async message(peer, message) {
    const rawText =
      message && typeof (message as any).text === 'function'
        ? await (message as any).text()
        : typeof message === 'string'
          ? message
          : String(message)
    const data = safeParseJson(String(rawText)) as ClientMessage | null
    if (!data || typeof data !== 'object') {
      try {
        peer.send(JSON.stringify({ type: 'error', payload: { message: '消息格式必须为 JSON' } }))
      } catch {}
      return
    }

    if (data.type === 'ping') {
      try {
        peer.send(JSON.stringify({ type: 'pong', payload: Date.now() }))
      } catch {}
      return
    }

    if (data.type === 'cancel') {
      const ctrl = active.get(peer.id)
      if (ctrl) {
        ctrl.abort()
        active.delete(peer.id)
      }
      try {
        peer.send(JSON.stringify({ type: 'status', payload: 'canceled' }))
      } catch {}
      return
    }

    if (data.type !== 'start') return

    const task = String(data.payload?.task ?? '').trim()
    if (!task) {
      try {
        peer.send(JSON.stringify({ type: 'error', payload: { message: '缺少 task' } }))
      } catch {}
      return
    }

    const prev = active.get(peer.id)
    if (prev) prev.abort()

    const ctrl = new AbortController()
    active.set(peer.id, ctrl)

    const cfg = useRuntimeConfig() as any
    const send = (type: string, payload: any) => {
      try {
        peer.send(JSON.stringify({ type, payload }))
      } catch {}
    }

    send('status', 'start')
    try {
      const mcp = cfg?.mcp || {}
      send('log', { level: 'info', message: `MCP 配置：provider=${String(mcp.provider || '')} render=${String(mcp.render)} baseUrl=${String(mcp.baseUrl || '')}`, ts: Date.now() })
    } catch {}

    try {
      const started = Date.now()
      const traceId = String((data.payload as any)?.trace_id ?? '').trim() || undefined
      const history = Array.isArray((data.payload as any)?.history)
        ? (data.payload as any).history
            .map((m: any) => ({
              role: String(m?.role ?? '').toLowerCase() === 'assistant' ? 'assistant' : 'user',
              content: String(m?.content ?? '').trim(),
            }))
            .filter((m: any) => m.content)
        : undefined

      const result = await executeExtractRun({
        task,
        options: (data.payload as any)?.options ?? {},
        config: cfg,
        signal: ctrl.signal,
        manager_task_json: String((data.payload as any)?.manager_task_json ?? '').trim() || undefined,
        session_id: String((data.payload as any)?.session_id ?? '').trim() || undefined,
        history,
        network:
          typeof (data.payload as any)?.network === 'boolean'
            ? Boolean((data.payload as any).network)
            : undefined,
        emit: (evt) => send(evt.type, evt.payload),
        source: 'ws',
      })
      const agentResult = buildCrawlerAgentResult({
        items: Array.isArray(result.items) ? result.items : [],
        outputContent:
          typeof result.output?.content === 'string'
            ? result.output.content
            : JSON.stringify(result.output?.content ?? ''),
        status: result.status,
        trace_id: traceId,
        latency_ms: Date.now() - started,
        serp_fallback: Boolean((result.meta as any)?.serp_fallback),
        clarifyReason: String((result as any)?.clarify?.reason ?? ''),
        stats: (result.stats && typeof result.stats === 'object' ? result.stats : {}) as Record<string, unknown>,
        taskPlan: {
          needsLogin: Boolean((result.taskPlan as any)?.needsLogin),
          preferredChannel: String((result.taskPlan as any)?.preferredChannel ?? ''),
        },
        lastError: String((result.stats as any)?.lastError ?? ''),
        meta: (result.meta && typeof result.meta === 'object' ? result.meta : {}) as Record<string, unknown>,
        failureTags: Array.isArray((result.meta as any)?.failure_tags) ? (result.meta as any).failure_tags : undefined,
        planNeedsLogin: Boolean((result.plan as any)?.needsLogin),
      })
      void appendAgentTraceLog({
        agent: 'crawler',
        path: '/_ws',
        trace_id: traceId,
        ok: agentResult.ok,
        latency_ms: agentResult.latency_ms,
        detail: String(result.status || ''),
      })
      send('result', { ...result, agentResult })
      send('status', 'end')
    } catch (e: any) {
      if (e?.message === 'aborted') return
      send('error', { message: String(e?.message || e) })
      send('status', 'error')
    } finally {
      if (active.get(peer.id) === ctrl) {
        active.delete(peer.id)
      }
    }
  },
  close(peer) {
    const ctrl = active.get(peer.id)
    if (ctrl) {
      ctrl.abort()
      active.delete(peer.id)
    }
  }
})
