/**
 * P3：多租户 scope 归一化
 */

export function normalizeTenantId(raw: unknown, env: NodeJS.ProcessEnv = process.env): string {
  const explicit = String(raw ?? '').trim()
  if (explicit) return explicit.slice(0, 64)
  const fromEnv = String(env.MGR_DEFAULT_TENANT_ID ?? env.TENANT_ID ?? 'default').trim()
  return (fromEnv || 'default').slice(0, 64)
}

export function isTenantScopeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.MGR_TENANT_SCOPE ?? '1').trim() !== '0'
}
