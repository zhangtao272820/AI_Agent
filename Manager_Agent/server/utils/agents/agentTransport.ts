export function withTimeout<T>(p: Promise<T>, timeoutMs: number, label: string, signal?: AbortSignal) {
  let t: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_r, rej) => {
    t = setTimeout(() => rej(new Error(`${label} timeout after ${timeoutMs}ms`)), timeoutMs)
  })
  const abort = new Promise<never>((_r, rej) => {
    if (!signal) return
    if (signal.aborted) {
      rej(new Error(`${label} aborted`))
      return
    }
    const onAbort = () => rej(new Error(`${label} aborted`))
    signal.addEventListener('abort', onAbort, { once: true })
  })
  return Promise.race([p, timeout, abort]).finally(() => {
    if (t) clearTimeout(t)
  })
}

export class LruCache<T> {
  private map = new Map<string, { v: T; ts: number }>()
  constructor(
    private max = 100,
    private ttlMs = 60_000
  ) {}
  get(key: string): T | undefined {
    const e = this.map.get(key)
    if (!e) return undefined
    if (Date.now() - e.ts > this.ttlMs) {
      this.map.delete(key)
      return undefined
    }
    this.map.delete(key)
    this.map.set(key, e)
    return e.v
  }
  set(key: string, v: T) {
    if (this.map.has(key)) this.map.delete(key)
    this.map.set(key, { v, ts: Date.now() })
    if (this.map.size > this.max) {
      const it = this.map.keys().next()
      if (!it.done) this.map.delete(it.value)
    }
  }
}

export function httpBaseFromWsUrl(wsUrl: string, fallback = 'http://localhost:13101') {
  try {
    const u = new URL(wsUrl)
    const protocol = u.protocol === 'wss:' ? 'https:' : 'http:'
    return `${protocol}//${u.host}`
  } catch {
    return fallback
  }
}

export function dbHttpBaseFromWsUrl(wsUrl: string) {
  return httpBaseFromWsUrl(wsUrl, 'http://localhost:13101')
}

export function agentHttpBaseFromWsUrl(wsUrl: string, fallbackPort: string) {
  return httpBaseFromWsUrl(wsUrl, `http://localhost:${fallbackPort}`)
}

export function normalizeDbWsUrl(input: string) {
  const url = String(input || '').trim()
  if (!url) return url
  if (/\/ws\/?$/.test(url)) return url
  if (/\/api\/chat\/?$/.test(url)) return url.replace(/\/+$/, '') + '/ws'
  return url
}

const agentReadyCache = new Map<string, { ok: boolean; at: number }>()
const AGENT_READY_CACHE_TTL_MS = 30_000

function agentReadyCacheKey(httpBase: string, probePaths: string[]) {
  return `${String(httpBase || '').replace(/\/+$/, '')}|${probePaths.join(',')}`
}

/** 带 TTL 的探活：热路径避免每次 25s 轮询 */
export async function waitForAgentHttpReadyCached(
  httpBase: string,
  maxWaitMs = 25_000,
  signal?: AbortSignal,
  probePaths: string[] = ['/api/health', '/']
) {
  const key = agentReadyCacheKey(httpBase, probePaths)
  const cached = agentReadyCache.get(key)
  if (cached?.ok && Date.now() - cached.at < AGENT_READY_CACHE_TTL_MS) return true
  const ok = await waitForAgentHttpReady(httpBase, maxWaitMs, signal, probePaths)
  agentReadyCache.set(key, { ok, at: Date.now() })
  return ok
}

/** Dev 模式下 Nuxt/Nitro 重启时 WS 端口会短暂 ECONNREFUSED，先等 HTTP 就绪 */
export async function waitForAgentHttpReady(
  httpBase: string,
  maxWaitMs = 25_000,
  signal?: AbortSignal,
  probePaths: string[] = ['/']
) {
  const base = String(httpBase || '').replace(/\/+$/, '')
  if (!base) return false
  const paths = probePaths.length ? probePaths : ['/']
  const deadline = Date.now() + Math.max(2_000, maxWaitMs)
  let delay = 600
  while (Date.now() < deadline) {
    if (signal?.aborted) return false
    for (const probePath of paths) {
      try {
        const ctrl = new AbortController()
        const t = setTimeout(() => ctrl.abort(), 2_500)
        const onAbort = () => ctrl.abort()
        signal?.addEventListener('abort', onAbort, { once: true })
        const res = await fetch(`${base}${probePath.startsWith('/') ? probePath : `/${probePath}`}`, {
          signal: ctrl.signal
        })
        clearTimeout(t)
        signal?.removeEventListener('abort', onAbort)
        if (res.ok || (res.status >= 200 && res.status < 500)) return true
      } catch {
        void 0
      }
    }
    await new Promise((r) => setTimeout(r, delay))
    delay = Math.min(Math.round(delay * 1.4), 3_500)
  }
  return false
}

export function isRetriableAgentTransportError(msg: string) {
  return /socket hang up|ECONNRESET|ECONNREFUSED|websocket closed|WebSocket is not open|No worker available/i.test(msg)
}

export function isCrawlerTransportError(err: unknown): boolean {
  const m = String((err as { message?: string })?.message || err || '').toLowerCase()
  return (
    m.includes('econnrefused') ||
    m.includes('enotfound') ||
    m.includes('fetch failed') ||
    m.includes('websocket closed') ||
    m.includes('socket hang up') ||
    m.includes('etimedout') ||
    m.includes('timeout') ||
    m.includes('getaddrinfo')
  )
}
