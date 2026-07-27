import path from 'node:path'
import { z } from 'zod'
import { bindSessionToUser, resolveUserId } from '../../graph/core/task/userIdentity'
import {
  deleteUserGoal,
  isUserGoalsEnabled,
  loadUserGoals,
  setUserGoalStatus,
  upsertUserGoal,
  type UserGoalStatus
} from '../../graph/core/task/userGoals'

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

const PrioritySchema = z.enum(['critical', 'high', 'normal', 'low']).optional()

const BodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('bind'),
    userId: UserIdSchema,
    sessionId: SessionIdSchema
  }),
  z.object({
    action: z.literal('upsert'),
    userId: UserIdSchema.optional(),
    sessionId: SessionIdSchema.optional(),
    goal: z.object({
      id: z.string().max(80).optional(),
      title: z.string().min(1).max(240),
      note: z.string().max(800).optional(),
      status: z.enum(['active', 'paused', 'done']).optional(),
      priority: PrioritySchema,
      deadline: z.string().max(40).optional()
    })
  }),
  z.object({
    action: z.literal('set_status'),
    userId: UserIdSchema.optional(),
    sessionId: SessionIdSchema.optional(),
    goalId: z.string().min(1).max(80),
    status: z.enum(['active', 'paused', 'done'])
  }),
  z.object({
    action: z.literal('delete'),
    userId: UserIdSchema.optional(),
    sessionId: SessionIdSchema.optional(),
    goalId: z.string().min(1).max(80)
  })
])

export default defineEventHandler(async (event) => {
  if (getMethod(event) !== 'POST') {
    throw createError({ statusCode: 405, statusMessage: 'Method Not Allowed' })
  }
  if (!isUserGoalsEnabled()) {
    throw createError({ statusCode: 403, statusMessage: 'User goals disabled' })
  }

  const body = BodySchema.parse(await readBody(event))
  const policyDir = path.join(process.cwd(), '.data')

  if (body.action === 'bind') {
    await bindSessionToUser(policyDir, body.sessionId, body.userId)
    const store = await loadUserGoals(policyDir, body.userId)
    return { ok: true, userId: body.userId, goals: store.goals }
  }

  const userId = await resolveUserId(policyDir, body.sessionId, body.userId)
  if (!userId) {
    throw createError({ statusCode: 400, statusMessage: 'userId or sessionId required' })
  }

  if (body.action === 'upsert') {
    const store = await upsertUserGoal(policyDir, userId, body.goal, body.sessionId)
    return { ok: true, userId, goals: store.goals }
  }
  if (body.action === 'set_status') {
    const store = await setUserGoalStatus(policyDir, userId, body.goalId, body.status as UserGoalStatus)
    return { ok: true, userId, goals: store.goals }
  }
  if (body.action === 'delete') {
    const store = await deleteUserGoal(policyDir, userId, body.goalId)
    return { ok: true, userId, goals: store.goals }
  }

  throw createError({ statusCode: 400, statusMessage: 'Unknown action' })
})
