import { defineEventHandler, createError } from 'h3'

type Bucket = {
  count: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()

function getClientIp(event: any) {
  const hdr = event.node.req.headers['x-forwarded-for']
  if (typeof hdr === 'string' && hdr.trim()) return hdr.split(',')[0]!.trim()
  const addr = event.node.req.socket?.remoteAddress
  return typeof addr === 'string' ? addr : 'unknown'
}

export default defineEventHandler((event) => {
  const url = event.node.req.url || ''
  if (!url.startsWith('/api/')) return

  const cfg = useRuntimeConfig().rateLimit as any
  const enabled = cfg?.enabled !== false
  if (!enabled) return

  const maxPerMinute =
    Number.isFinite(cfg?.maxPerMinute) && cfg.maxPerMinute > 0 ? Number(cfg.maxPerMinute) : 60

  const ip = getClientIp(event)
  const key = `${ip}`
  const now = Date.now()
  const windowMs = 60_000

  if (buckets.size > 5000) {
    for (const [k, b] of buckets) {
      if (b.resetAt <= now) buckets.delete(k)
    }
  }

  const bucket = buckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return
  }

  bucket.count += 1
  if (bucket.count > maxPerMinute) {
    throw createError({ statusCode: 429, statusMessage: 'Too Many Requests' })
  }
})
