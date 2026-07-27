import path from 'node:path'
import { z } from 'zod'
import {
  agentUpsertSharedTask,
  isSharedTaskStackEnabled,
  isSharedTaskStackTokenValid,
  loadSharedTaskStackForUser
} from '../../graph/core/task/sharedTaskStack'
import { resolveUserId } from '../../graph/core/task/userIdentity'
import { setTaskStackStatus, type TaskPriority, type TaskStatus } from '../../graph/core/task/taskStack'

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

function requireSharedTaskStackAccess(event: { headers?: Record<string, string | undefined> }) {
  if (!isSharedTaskStackEnabled()) {
    throw createError({ statusCode: 404, statusMessage: 'Shared task stack disabled' })
  }
  const token = String(
    getHeader(event as Parameters<typeof getHeader>[0], 'x-manager-task-stack-token') ||
      getHeader(event as Parameters<typeof getHeader>[0], 'x-manager-ops-token') ||
      ''
  ).trim()
  if (!isSharedTaskStackTokenValid(token)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }
}

const BodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('upsert'),
    userId: UserIdSchema,
    sessionId: SessionIdSchema.optional(),
    agentId: z.string().min(1).max(32).optional(),
    task: z.object({
      title: z.string().min(1).max(240),
      note: z.string().max(600).optional(),
      priority: z.enum(['critical', 'high', 'normal', 'low']).optional(),
      status: z.enum(['active', 'paused', 'done']).optional()
    })
  }),
  z.object({
    action: z.literal('set_status'),
    userId: UserIdSchema,
    sessionId: SessionIdSchema,
    taskId: z.string().min(1).max(80),
    status: z.enum(['active', 'paused', 'done'])
  }),
  z.object({
    action: z.literal('list'),
    userId: UserIdSchema,
    sessionId: SessionIdSchema.optional()
  })
])

/** 子 Agent 写入/更新共享任务栈（按 userId 定位会话，未指定 sessionId 时用最近活跃会话） */
export default defineEventHandler(async (event) => {
  if (getMethod(event) !== 'POST') {
    throw createError({ statusCode: 405, statusMessage: 'Method Not Allowed' })
  }
  requireSharedTaskStackAccess(event)
  const body = BodySchema.parse(await readBody(event))
  const policyDir = path.join(process.cwd(), '.data')

  if (body.action === 'list') {
    const userId = await resolveUserId(policyDir, body.sessionId, body.userId)
    if (!userId) throw createError({ statusCode: 400, statusMessage: 'invalid userId' })
    const view = await loadSharedTaskStackForUser(policyDir, userId)
    return { ok: true, ...view }
  }

  if (body.action === 'upsert') {
    try {
      const r = await agentUpsertSharedTask(policyDir, {
        userId: body.userId,
        sessionId: body.sessionId,
        agentId: body.agentId,
        title: body.task.title,
        note: body.task.note,
        priority: body.task.priority as TaskPriority | undefined,
        status: body.task.status as TaskStatus | undefined
      })
      const view = await loadSharedTaskStackForUser(policyDir, r.userId)
      return { ok: true, stack: r.stack, sessionId: r.sessionId, userId: r.userId, shared: view }
    } catch (e: unknown) {
      const msg = String((e as Error)?.message || e || 'upsert_failed')
      throw createError({ statusCode: 400, statusMessage: msg })
    }
  }

  if (body.action === 'set_status') {
    const userId = await resolveUserId(policyDir, body.sessionId, body.userId)
    if (!userId) throw createError({ statusCode: 400, statusMessage: 'invalid userId' })
    const stack = await setTaskStackStatus(policyDir, body.sessionId, body.taskId, body.status as TaskStatus)
    const view = await loadSharedTaskStackForUser(policyDir, userId)
    return { ok: true, stack, shared: view }
  }

  throw createError({ statusCode: 400, statusMessage: 'Unknown action' })
})
