import { recallProcessMemory } from '#agent-shared/processMemoryStore'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const question = String(query.q ?? query.question ?? '').trim()
  const scenarioKey = String(query.scenario_key ?? query.scenarioKey ?? '').trim()
  const limitRaw = Number(query.limit)
  const limit = Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 5

  if (!question) {
    throw createError({ statusCode: 400, statusMessage: 'q 不能为空' })
  }

  const items = await recallProcessMemory(question, {
    scenarioKey: scenarioKey || undefined,
    limit
  })
  return { ok: true, count: items.length, items }
})
