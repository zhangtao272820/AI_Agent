function verifyInternalToken(event: any): void {
  const expected = String(process.env.CLAWHIVE_INTERNAL_TOKEN || process.env.AGENT_INTERNAL_TOKEN || '').trim()
  if (!expected) {
    throw createError({ statusCode: 503, statusMessage: 'CLAWHIVE_INTERNAL_TOKEN 未配置' })
  }
  const got = String(getHeader(event, 'x-clawhive-internal-token') || '').trim()
  if (!got || got !== expected) {
    throw createError({ statusCode: 401, statusMessage: '无效的内部服务令牌' })
  }
}

/** POST /api/internal/skills/reload — 平台赋能后通知（Phase B loader 接入后可清缓存） */
export default defineEventHandler((event) => {
  if (getMethod(event) !== 'POST') {
    throw createError({ statusCode: 405, statusMessage: 'Method Not Allowed' })
  }
  verifyInternalToken(event)
  return { ok: true, message: 'db playbook reload acknowledged' }
})
