import path from 'node:path'
import { getQuery } from 'h3'
import { buildAutonomousPlansDashboard } from '../../graph/core/task/autonomousPlan'

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const sessionId = String(q.sessionId || '').trim() || undefined
  const policyDir = path.join(process.cwd(), '.data')
  const dashboard = await buildAutonomousPlansDashboard(policyDir, sessionId)
  return { ok: true, ...dashboard }
})
