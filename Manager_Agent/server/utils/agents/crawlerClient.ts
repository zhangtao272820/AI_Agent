import WebSocket from 'ws'
import { agentWsUrlToHttpOrigin, resolveAgentUrl, resolveCrawlerWsCandidates } from '../platform/agentEndpoints'
import { withTimeout, waitForAgentHttpReady, isCrawlerTransportError } from './agentTransport'
import { buildAgentTraceHeaders, withTraceBody } from './agentTrace'
import { wrapCrawlerResult } from './agentResult'
import { crawlerHttpAsyncEnabled, pollAgentJob, type AgentJobStatus } from './pollAgentJob'
import { isManagerDockerRuntime } from '../platform/managerEnvModes'

async function callCrawlerAgentHttp(params: {
  crawlerAgentWsUrl: string
  timeoutMs: number
  task: string
  managerTask?: Record<string, unknown> | string | null
  sessionId?: string
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
  options?: { maxItems?: number; maxPages?: number }
  sendThinking?: (text: string) => void
  signal?: AbortSignal
  traceId?: string
}) {
  const origins = [
    agentWsUrlToHttpOrigin(params.crawlerAgentWsUrl),
    ...resolveCrawlerWsCandidates(process.env).map((ws) => agentWsUrlToHttpOrigin(ws))
  ].filter(Boolean)
  const uniqOrigins = Array.from(new Set(origins))
  if (!uniqOrigins.length) throw new Error('crawlerAgent http origin unavailable')

  params.sendThinking?.('网页爬虫 Agent：WebSocket 不可用，改用 HTTP /api/extract…')
  const manager_task_json =
    typeof params.managerTask === 'string'
      ? params.managerTask.trim() || undefined
      : params.managerTask && typeof params.managerTask === 'object'
        ? JSON.stringify(params.managerTask)
        : undefined
  const history = Array.isArray(params.history)
    ? params.history
        .map((m) => ({
          role: String(m?.role ?? '').toLowerCase() === 'assistant' ? 'assistant' : 'user',
          content: String(m?.content ?? '').trim()
        }))
        .filter((m) => m.content)
        .slice(-6)
    : undefined
  const body = JSON.stringify(
    withTraceBody(
      {
        task: params.task,
        ...(manager_task_json ? { manager_task_json } : {}),
        ...(params.sessionId ? { session_id: params.sessionId } : {}),
        ...(history?.length ? { history } : {}),
        ...(params.options && Object.keys(params.options).length ? { options: params.options } : {})
      },
      params.traceId
    )
  )

  let lastErr: unknown = null
  for (const origin of uniqOrigins) {
    const url = `${origin.replace(/\/+$/, '')}/api/extract`
    try {
      const res = await withTimeout(
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...buildAgentTraceHeaders(params.traceId) },
          body,
          signal: params.signal
        }),
        params.timeoutMs,
        'crawlerAgentHttp',
        params.signal
      )
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`crawlerAgent http ${res.status}: ${text || res.statusText}`)
      }
      const data = (await res.json().catch(() => null)) as any
      return data?.ok === false ? data : (data ?? {})
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr || 'crawlerAgent http failed'))
}

function mapCrawlJobStatus(raw: string): AgentJobStatus {
  const s = String(raw || '').toLowerCase()
  if (s === 'done') return 'done'
  if (s === 'failed') return 'failed'
  if (s === 'canceled') return 'canceled'
  if (s === 'error') return 'error'
  if (s === 'queued') return 'queued'
  return 'running'
}

async function callCrawlerAgentHttpAsync(params: {
  crawlerAgentWsUrl: string
  timeoutMs: number
  task: string
  managerTask?: Record<string, unknown> | string | null
  sessionId?: string
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
  options?: { maxItems?: number; maxPages?: number }
  sendThinking?: (text: string) => void
  signal?: AbortSignal
  traceId?: string
}) {
  const origins = [
    agentWsUrlToHttpOrigin(params.crawlerAgentWsUrl),
    ...resolveCrawlerWsCandidates(process.env).map((ws) => agentWsUrlToHttpOrigin(ws))
  ].filter(Boolean)
  const uniqOrigins = Array.from(new Set(origins))
  if (!uniqOrigins.length) throw new Error('crawlerAgent http origin unavailable')

  params.sendThinking?.('网页爬虫 Agent：提交异步任务 /api/extract/async…')
  const manager_task_json =
    typeof params.managerTask === 'string'
      ? params.managerTask.trim() || undefined
      : params.managerTask && typeof params.managerTask === 'object'
        ? JSON.stringify(params.managerTask)
        : undefined
  const history = Array.isArray(params.history)
    ? params.history
        .map((m) => ({
          role: String(m?.role ?? '').toLowerCase() === 'assistant' ? 'assistant' : 'user',
          content: String(m?.content ?? '').trim()
        }))
        .filter((m) => m.content)
        .slice(-6)
    : undefined
  const bodyObj = withTraceBody(
    {
      task: params.task,
      ...(manager_task_json ? { manager_task_json } : {}),
      ...(params.sessionId ? { session_id: params.sessionId } : {}),
      ...(history?.length ? { history } : {}),
      ...(params.options && Object.keys(params.options).length ? { options: params.options } : {})
    },
    params.traceId
  )
  const headers = { 'Content-Type': 'application/json', ...buildAgentTraceHeaders(params.traceId) }

  let lastErr: unknown = null
  for (const origin of uniqOrigins) {
    const base = origin.replace(/\/+$/, '')
    try {
      const result = await pollAgentJob<any>({
        timeoutMs: params.timeoutMs,
        signal: params.signal,
        intervalMs: 2000,
        submit: async () => {
          const res = await withTimeout(
            fetch(`${base}/api/extract/async`, {
              method: 'POST',
              headers,
              body: JSON.stringify(bodyObj),
              signal: params.signal
            }),
            Math.min(params.timeoutMs, 30_000),
            'crawlerAgentHttpAsyncSubmit',
            params.signal
          )
          if (res.status === 503) {
            throw new Error('crawler async queue disabled')
          }
          if (!res.ok) {
            const text = await res.text().catch(() => '')
            throw new Error(`crawlerAgent async ${res.status}: ${text || res.statusText}`)
          }
          const data = (await res.json().catch(() => ({}))) as { job_id?: string; jobId?: string }
          const jobId = String(data.job_id || data.jobId || '').trim()
          if (!jobId) throw new Error('crawlerAgent async: missing job_id')
          return { jobId }
        },
        poll: async (jobId) => {
          const res = await fetch(`${base}/api/jobs/${encodeURIComponent(jobId)}`, {
            method: 'GET',
            headers: buildAgentTraceHeaders(params.traceId),
            signal: params.signal
          })
          const data = (await res.json().catch(() => ({}))) as any
          if (!res.ok) throw new Error(String(data?.statusMessage || data?.message || res.statusText))
          const job = data?.job || data
          const status = mapCrawlJobStatus(String(job?.status || 'running'))
          const agentResult = job?.result?.agentResult
          const payload = agentResult ?? job?.result ?? job
          if (status === 'running' || status === 'queued') {
            params.sendThinking?.(`网页爬虫 Agent：${status === 'queued' ? '排队中' : '执行中'}…`)
          }
          return {
            status,
            result: payload,
            error: String(job?.error || ''),
            raw: job
          }
        }
      })
      return result?.ok === false ? result : (result ?? {})
    } catch (e) {
      lastErr = e
      const msg = String((e as Error)?.message || e || '')
      if (msg.includes('async queue disabled')) throw e
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr || 'crawlerAgent http async failed'))
}

async function callCrawlerAgentWs(params: {
  crawlerAgentWsUrl: string
  timeoutMs: number
  task: string
  managerTask?: Record<string, unknown> | string | null
  sessionId?: string
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
  options?: { maxItems?: number; maxPages?: number }
  sendThinking?: (text: string) => void
  signal?: AbortSignal
  traceId?: string
}) {
  const ws = new WebSocket(params.crawlerAgentWsUrl)
  return await withTimeout(
    new Promise<any>((resolve, reject) => {
      let result: any = null
      let sawEnd = false
      const onAbort = () => {
        cleanup()
        reject(new Error('crawlerAgent aborted'))
      }
      const cleanup = () => {
        try {
          ws.removeAllListeners()
          ws.close()
        } catch {}
        try {
          params.signal?.removeEventListener('abort', onAbort)
        } catch {}
      }
      if (params.signal) params.signal.addEventListener('abort', onAbort)
      ws.on('open', () => {
        const manager_task_json =
          typeof params.managerTask === 'string'
            ? params.managerTask.trim() || undefined
            : params.managerTask && typeof params.managerTask === 'object'
              ? JSON.stringify(params.managerTask)
              : undefined
        const history = Array.isArray(params.history)
          ? params.history
              .map((m) => ({
                role: String(m?.role ?? '').toLowerCase() === 'assistant' ? 'assistant' : 'user',
                content: String(m?.content ?? '').trim(),
              }))
              .filter((m) => m.content)
              .slice(-6)
          : undefined
        ws.send(
          JSON.stringify({
            type: 'start',
            payload: {
              task: params.task,
              ...(manager_task_json ? { manager_task_json } : {}),
              ...(params.sessionId ? { session_id: params.sessionId } : {}),
              ...(params.traceId ? { trace_id: params.traceId } : {}),
              ...(history?.length ? { history } : {}),
              ...(params.options && Object.keys(params.options).length ? { options: params.options } : {}),
            },
          }),
        )
      })
      ws.on('message', (raw) => {
        try {
          const data = JSON.parse(String(raw || '{}')) as any
          const type = String(data?.type || '')
          if (type === 'log') {
            const m = String(data?.payload?.message || '')
            if (m) params.sendThinking?.(`网页爬虫 Agent：${m}`)
            return
          }
          if (type === 'result') {
            result = data.payload
            return
          }
          if (type === 'status' && data.payload === 'end') {
            sawEnd = true
            cleanup()
            resolve(result)
          }
          if (type === 'error') {
            cleanup()
            reject(new Error(String(data?.payload?.message || 'crawlerAgent error')))
          }
        } catch (e) {
          void e
        }
      })
      ws.on('error', (err) => {
        cleanup()
        reject(err)
      })
      ws.on('close', () => {
        if (sawEnd) resolve(result)
        else reject(new Error('crawlerAgent websocket closed unexpectedly'))
      })
    }),
    params.timeoutMs,
    'crawlerAgent',
    params.signal
  )
}

export async function callCrawlerAgent(params: {
  crawlerAgentWsUrl: string
  timeoutMs: number
  task: string
  managerTask?: Record<string, unknown> | string | null
  sessionId?: string
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
  options?: { maxItems?: number; maxPages?: number }
  sendThinking?: (text: string) => void
  signal?: AbortSignal
  traceId?: string
}) {
  params.sendThinking?.('网页爬虫 Agent：正在联网检索并提取网页数据…')
  const primaryWs = resolveAgentUrl(params.crawlerAgentWsUrl, process.env) || String(params.crawlerAgentWsUrl || '').trim()
  const wsUrls = Array.from(new Set([primaryWs, ...resolveCrawlerWsCandidates(process.env)].filter(Boolean)))
  const httpBases = Array.from(
    new Set(wsUrls.map((ws) => agentWsUrlToHttpOrigin(ws)).filter(Boolean))
  )
  const docker = isManagerDockerRuntime(process.env)
  const bootWaitMs = docker ? 120_000 : 25_000

  for (const httpBase of httpBases) {
    const ready = await waitForAgentHttpReady(httpBase, bootWaitMs, params.signal, ['/', '/api/health'])
    if (ready) break
  }
  if (httpBases.length && !params.signal?.aborted) {
    const anyReady = await Promise.all(
      httpBases.map((b) => waitForAgentHttpReady(b, 3_000, params.signal, ['/', '/api/health']))
    )
    if (!anyReady.some(Boolean)) {
      params.sendThinking?.('网页爬虫 Agent：服务尚未就绪，等待 dev 服务启动…')
      for (const httpBase of httpBases) {
        await waitForAgentHttpReady(httpBase, docker ? 180_000 : 45_000, params.signal, ['/', '/api/health'])
      }
    }
  }

  const maxAttempts = docker ? 6 : 4
  let lastErr: unknown = null
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      const waitMs = Math.min(15_000, 1_500 * attempt * attempt)
      params.sendThinking?.(
        `网页爬虫 Agent：连接异常，${Math.round(waitMs / 1000)}s 后重试（${attempt + 1}/${maxAttempts}）…`
      )
      await new Promise((r) => setTimeout(r, waitMs))
      if (params.signal?.aborted) break
      for (const httpBase of httpBases) {
        await waitForAgentHttpReady(httpBase, 20_000, params.signal, ['/', '/api/health'])
      }
    }

    for (let i = 0; i < wsUrls.length; i++) {
      const wsUrl = wsUrls[i]!
      if (attempt === 0 && i > 0) params.sendThinking?.(`网页爬虫 Agent：切换备用地址 ${wsUrl}…`)
      try {
        return await callCrawlerAgentWs({ ...params, crawlerAgentWsUrl: wsUrl })
      } catch (e) {
        lastErr = e
        if (!isCrawlerTransportError(e)) throw e
      }
    }
    try {
      if (crawlerHttpAsyncEnabled()) {
        return await callCrawlerAgentHttpAsync({ ...params, crawlerAgentWsUrl: wsUrls[0] || params.crawlerAgentWsUrl })
      }
      return await callCrawlerAgentHttp({ ...params, crawlerAgentWsUrl: wsUrls[0] || params.crawlerAgentWsUrl })
    } catch (e) {
      lastErr = e
      const msg = String((e as Error)?.message || e || '')
      if (msg.includes('async queue disabled') || (crawlerHttpAsyncEnabled() && isCrawlerTransportError(e))) {
        try {
          return await callCrawlerAgentHttp({ ...params, crawlerAgentWsUrl: wsUrls[0] || params.crawlerAgentWsUrl })
        } catch (syncErr) {
          lastErr = syncErr
          if (!isCrawlerTransportError(syncErr)) throw syncErr
        }
      } else if (!isCrawlerTransportError(e)) {
        throw e
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr ?? 'crawlerAgent failed'))
}
