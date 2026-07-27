import { queryTenantAuditStats } from '#agent-shared/tenantAuditStore'

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const tenantId = String(q.tenant_id || q.tenantId || '').trim() || undefined
  const stats = await queryTenantAuditStats(tenantId)
  return { ok: Boolean(stats), stats }
})
