/** 校验 ClawHive 内部服务令牌（未配置时跳过，便于本机开发）。 */

export function ensureInternalAgentAccess(event: { node?: { req?: { headers?: Record<string, string | string[] | undefined> } } }) {
  const expected = String(
    process.env.CLAWHIVE_INTERNAL_TOKEN || process.env.AGENT_INTERNAL_TOKEN || ''
  ).trim()
  if (!expected) return

  const headers = event?.node?.req?.headers || {}
  const raw =
    headers['x-clawhive-internal-token'] ||
    headers['x-internal-token'] ||
    ''
  const got = String(Array.isArray(raw) ? raw[0] : raw || '').trim()
  if (!got || got !== expected) {
    throw createError({ statusCode: 401, statusMessage: 'invalid internal token' })
  }
}
