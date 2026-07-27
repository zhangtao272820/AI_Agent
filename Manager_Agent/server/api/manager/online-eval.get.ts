import { getLatestEvalRun, seedManagerEvalSuiteFromGolden } from '#agent-shared/onlineEvalStore'

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const suiteId = String(q.suiteId || 'manager_golden_smoke').trim()
  if (suiteId === 'manager_golden_smoke') {
    await seedManagerEvalSuiteFromGolden().catch(() => undefined)
  }
  const latest = await getLatestEvalRun(suiteId)
  return { ok: true, suiteId, latest }
})
