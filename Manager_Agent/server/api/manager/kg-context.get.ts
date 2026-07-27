import { formatKgBlockForPlanner, recallKgContextForPlanner } from '#agent-shared/kgMemoryStore'

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const question = String(q.q || q.question || '').trim()
  const tenantId = String(q.tenant_id || q.tenantId || '').trim() || undefined
  const limit = Math.max(1, Math.min(20, Number(q.limit ?? 8) || 8))
  if (!question) return { ok: false, message: 'missing q' }
  const entities = await recallKgContextForPlanner(question, { tenantId, limit })
  return {
    ok: true,
    count: entities.length,
    entities,
    block: formatKgBlockForPlanner(entities)
  }
})
