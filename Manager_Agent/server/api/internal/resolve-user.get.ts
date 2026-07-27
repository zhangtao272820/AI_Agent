function verifyInternalToken(event: any): void {
  const expected = String(process.env.CLAWHIVE_INTERNAL_TOKEN || process.env.MANAGER_OPS_TOKEN || '').trim()
  if (!expected) {
    throw createError({ statusCode: 503, statusMessage: 'CLAWHIVE_INTERNAL_TOKEN 未配置' })
  }
  const got = String(getHeader(event, 'x-clawhive-internal-token') || '').trim()
  if (!got || got !== expected) {
    throw createError({ statusCode: 401, statusMessage: '无效的内部服务令牌' })
  }
}

/** GET /api/internal/resolve-user?session_id= — RAG 等子 Agent 解析 userId（替代 sibling 文件读） */
export default defineEventHandler(async (event) => {
  verifyInternalToken(event)
  const q = getQuery(event)
  const sessionId = String(q.session_id || q.sessionId || '').trim()
  if (!sessionId) {
    throw createError({ statusCode: 400, statusMessage: 'missing session_id' })
  }
  const policyDir = `${process.cwd()}/.data`
  const { resolveSessionUserId, sanitizeUserId } = await import('#agent-shared/userSessionMapStore')
  const userId = (await resolveSessionUserId(sessionId, policyDir)) ?? sanitizeUserId(sessionId)
  return { ok: true, sessionId, userId: userId ?? null }
})
