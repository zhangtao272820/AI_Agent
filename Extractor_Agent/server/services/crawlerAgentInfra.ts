import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

type ProxyEntry = {
  server: string
  username?: string
  password?: string
}

function parseProxyLine(line: string): ProxyEntry | null {
  const raw = String(line ?? '').trim()
  if (!raw) return null
  if (raw.startsWith('#')) return null
  const normalized = raw.includes('://') ? raw : `http://${raw}`
  try {
    const u = new URL(normalized)
    if (!u.hostname || !u.port) return null
    const server = `${u.protocol}//${u.hostname}:${u.port}`
    const username = u.username ? decodeURIComponent(u.username) : undefined
    const password = u.password ? decodeURIComponent(u.password) : undefined
    return { server, username, password }
  } catch {
    return null
  }
}

export class ProxyPool {
  private entries: ProxyEntry[] = []
  private nextIndex = 0
  private badUntilTs = new Map<string, number>()
  private lastLoadedAt = 0

  constructor(private readonly filePath: string) {}

  private async loadIfNeeded() {
    const now = Date.now()
    if (this.entries.length > 0 && now - this.lastLoadedAt < 60_000) return
    this.lastLoadedAt = now
    try {
      const text = await readFile(this.filePath, 'utf8')
      const lines = text.split(/\r?\n/)
      const entries = lines.map(parseProxyLine).filter(Boolean) as ProxyEntry[]
      this.entries = entries
      this.nextIndex = 0
    } catch {
      this.entries = []
      this.nextIndex = 0
    }
  }

  async getNext(): Promise<ProxyEntry | null> {
    await this.loadIfNeeded()
    if (this.entries.length === 0) return null

    const now = Date.now()
    for (let i = 0; i < this.entries.length; i++) {
      const idx = (this.nextIndex + i) % this.entries.length
      const candidate = this.entries[idx]
      const badUntil = this.badUntilTs.get(candidate.server) ?? 0
      if (badUntil > now) continue
      this.nextIndex = (idx + 1) % this.entries.length
      return candidate
    }
    return null
  }

  markBad(proxy: ProxyEntry) {
    const key = proxy.server
    const now = Date.now()
    this.badUntilTs.set(key, now + 5 * 60_000)
  }
}

function sleep(ms: number, signal?: AbortSignal) {
  const t = Math.max(0, Math.floor(ms))
  if (!t) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      resolve()
    }, t)
    const onAbort = () => {
      cleanup()
      reject(new Error('aborted'))
    }
    const cleanup = () => {
      clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', onAbort)
    }
    if (signal?.aborted) return onAbort()
    if (signal) signal.addEventListener('abort', onAbort, { once: true })
  })
}

export class DomainRateLimiter {
  private buckets = new Map<string, { tokens: number; lastRefill: number; cfg: { tokensPerInterval: number; intervalMs: number } }>()
  private backoffUntil = new Map<string, number>()
  constructor(
    private readonly base: { tokensPerInterval: number; intervalMs: number; backoffBaseMs: number; backoffMaxMs: number },
    private readonly overrides?: Record<string, { tokensPerInterval?: number; intervalMs?: number }>
  ) {}
  private getCfg(host: string) {
    const ov = this.overrides?.[host] || {}
    return { tokensPerInterval: ov.tokensPerInterval ?? this.base.tokensPerInterval, intervalMs: ov.intervalMs ?? this.base.intervalMs }
  }
  async awaitSlot(host: string, signal: AbortSignal) {
    const now = Date.now()
    const until = this.backoffUntil.get(host) ?? 0
    if (until > now) await sleep(until - now, signal)
    let b = this.buckets.get(host)
    if (!b) {
      const cfg = this.getCfg(host)
      b = { tokens: cfg.tokensPerInterval, lastRefill: now, cfg }
      this.buckets.set(host, b)
    }
    while (true) {
      const now2 = Date.now()
      const elapsed = now2 - b.lastRefill
      if (elapsed >= b.cfg.intervalMs) {
        const add = Math.floor(elapsed / b.cfg.intervalMs) * b.cfg.tokensPerInterval
        b.tokens = Math.min(b.cfg.tokensPerInterval, b.tokens + add)
        b.lastRefill = now2
      }
      if (b.tokens > 0) {
        b.tokens -= 1
        return
      }
      const waitMs = Math.max(5, b.cfg.intervalMs - (now2 - b.lastRefill))
      await sleep(waitMs, signal)
    }
  }
  backoff(host: string, factor: number) {
    const base = Math.max(200, this.base.backoffBaseMs)
    const max = Math.max(base, this.base.backoffMaxMs)
    const now = Date.now()
    const cur = this.backoffUntil.get(host) ?? now
    const next = Math.min(now + max, Math.max(cur, now) + base * factor)
    this.backoffUntil.set(host, next)
  }
}

export class CheckpointManager {
  private lastSaved = 0
  constructor(private readonly dir: string, private readonly resumeId: string, private readonly intervalMs: number) {}
  async load(): Promise<any | null> {
    try {
      const fp = path.join(this.dir, `${this.resumeId}.json`)
      const text = await readFile(fp, 'utf8')
      return JSON.parse(text)
    } catch {
      return null
    }
  }
  async maybeSave(obj: any) {
    const now = Date.now()
    if (now - this.lastSaved < this.intervalMs) return
    this.lastSaved = now
    try {
      await mkdir(this.dir, { recursive: true })
      const fp = path.join(this.dir, `${this.resumeId}.json`)
      await writeFile(fp, JSON.stringify(obj, null, 2), 'utf8')
    } catch {}
  }
}

