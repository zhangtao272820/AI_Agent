import { buildRunObservabilityPayload } from '../../graph/core/runtime/runObservability'

export default defineEventHandler(async (event) => {
  const runId = String(getRouterParam(event, 'runId') || '').trim()
  if (!runId) {
    throw createError({ statusCode: 400, statusMessage: 'runId required' })
  }
  const payload = await buildRunObservabilityPayload(runId)
  return { ok: true, ...payload }
})
