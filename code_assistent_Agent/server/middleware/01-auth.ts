import { defineEventHandler, createError } from 'h3'
import { jwtVerify } from 'jose'

function getBearerToken(event: any) {
  const auth = event.node.req.headers.authorization
  if (typeof auth !== 'string') return ''
  const m = auth.match(/^Bearer\s+(.+)$/i)
  return m?.[1]?.trim() ?? ''
}

export default defineEventHandler(async (event) => {
  const url = event.node.req.url || ''
  if (!url.startsWith('/api/')) return

  const cfg = useRuntimeConfig().auth as any
  const enabled = cfg?.enabled === true
  if (!enabled) return

  const secret = typeof cfg?.jwtSecret === 'string' ? cfg.jwtSecret : ''
  if (!secret) {
    throw createError({ statusCode: 500, statusMessage: 'Missing JWT_SECRET' })
  }

  const token = getBearerToken(event)
  if (!token) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret))
    const sub = typeof payload.sub === 'string' ? payload.sub : ''
    const scopeRaw = (payload as any).scope
    const scopes =
      typeof scopeRaw === 'string'
        ? scopeRaw
            .split(/[,\s]+/)
            .map((s: string) => s.trim())
            .filter(Boolean)
        : Array.isArray(scopeRaw)
          ? scopeRaw.filter((s: any) => typeof s === 'string' && s.trim()).map((s: string) => s.trim())
          : []
    ;(event as any).context.auth = {
      sub: sub || 'unknown',
      scopes
    }
  } catch {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
})
