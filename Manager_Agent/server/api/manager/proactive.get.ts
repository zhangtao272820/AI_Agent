import path from 'node:path'
import { z } from 'zod'
import { getPendingProactiveNudges, markProactiveNudgeConsumed, buildProactiveDashboard } from '../../graph/core/task/proactiveLoop'

const SessionIdSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9_-]+$/)

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const policyDir = path.join(process.cwd(), '.data')

  if (query.consume && query.nudgeId && query.sessionId) {
    const sessionId = SessionIdSchema.parse(String(query.sessionId))
    const nudgeId = String(query.nudgeId).trim()
    await markProactiveNudgeConsumed(policyDir, sessionId, nudgeId)
    return { ok: true, consumed: nudgeId }
  }

  if (query.sessionId) {
    const sessionId = SessionIdSchema.parse(String(query.sessionId))
    const nudges = await getPendingProactiveNudges(policyDir, sessionId)
    return { ok: true, sessionId, nudges }
  }

  const dashboard = await buildProactiveDashboard(policyDir)
  return { ok: true, dashboard }
})
