import path from 'node:path'
import { z } from 'zod'
import { resolveUserId } from '../../graph/core/task/userIdentity'
import { buildUserGoalsDashboard, isUserGoalsEnabled, loadUserGoals } from '../../graph/core/task/userGoals'

const UserIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/)

const SessionIdSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9_-]+$/)

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const policyDir = path.join(process.cwd(), '.data')

  if (!isUserGoalsEnabled()) {
    return { ok: true, enabled: false, goals: [], userId: null }
  }

  if (query.dashboard === '1' || query.dashboard === 'true') {
    const userId = query.userId ? UserIdSchema.parse(String(query.userId)) : undefined
    const dashboard = await buildUserGoalsDashboard(policyDir, userId)
    return { ok: true, dashboard }
  }

  const sessionId = query.sessionId ? SessionIdSchema.parse(String(query.sessionId)) : undefined
  const explicitUserId = query.userId ? UserIdSchema.parse(String(query.userId)) : undefined
  const userId = await resolveUserId(policyDir, sessionId, explicitUserId)
  if (!userId) {
    return { ok: true, enabled: true, userId: null, goals: [] }
  }
  const store = await loadUserGoals(policyDir, userId)
  return { ok: true, enabled: true, userId, goals: store.goals, updatedAt: store.updatedAt }
})
