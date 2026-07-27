import { listToolCallAuditForRun, listToolCallAuditRecent } from '#agent-shared/toolCallAuditStore'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const runId = String(query.run_id ?? query.runId ?? '').trim()
  const sessionId = String(query.session_id ?? query.sessionId ?? '').trim()
  const limitRaw = Number(query.limit)
  const limit = Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 50

  if (runId) {
    const items = await listToolCallAuditForRun(runId)
    return { ok: true, runId, items }
  }

  const items = await listToolCallAuditRecent({
    sessionId: sessionId || undefined,
    limit
  })
  return { ok: true, sessionId: sessionId || null, items }
})
