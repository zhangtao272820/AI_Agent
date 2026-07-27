import { createError, getHeader, getQuery, type H3Event } from 'h3'

function extractBearerToken(v: string) {
  const s = String(v || '').trim()
  if (!s) return ''
  const m = s.match(/^Bearer\s+(.+)$/i)
  return m?.[1] ? String(m[1]).trim() : ''
}

export function assertLobsterAuth(event: H3Event, cfg: any) {
  const expected = String(cfg?.lobster?.adminToken || '').trim()
  if (!expected) return

  const q = getQuery(event) as any
  const fromQuery = String(q?.token ?? '').trim()
  const fromHeader = String(getHeader(event, 'x-lobster-token') || '').trim()
  const fromAuth = extractBearerToken(String(getHeader(event, 'authorization') || ''))
  const provided = fromHeader || fromAuth || fromQuery

  if (!provided || provided !== expected) {
    throw createError({ statusCode: 401, statusMessage: '未授权：缺少或错误的访问令牌' })
  }
}
