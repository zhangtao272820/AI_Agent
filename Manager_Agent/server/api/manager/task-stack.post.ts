import path from 'node:path'
import { z } from 'zod'
import {
  clearTaskStack,
  deleteTaskStackItem,
  loadTaskStack,
  migrateTaskStackItems,
  setTaskStackStatus,
  syncInsightLinkedTasks,
  upsertTaskStackItem,
  type TaskStatus
} from '../../graph/core/task/taskStack'
import { extractAndUpsertTasksFromAssistantText } from '../../graph/core/task/taskStackLlmExtract'

const SessionIdSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9_-]+$/)

const PrioritySchema = z.enum(['critical', 'high', 'normal', 'low']).optional()
const StatusSchema = z.enum(['active', 'paused', 'done']).optional()

const BodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('upsert'),
    sessionId: SessionIdSchema,
    task: z.object({
      id: z.string().max(80).optional(),
      title: z.string().min(1).max(240),
      note: z.string().max(600).optional(),
      status: StatusSchema,
      priority: PrioritySchema,
      deadline: z.string().max(40).optional(),
      source: z.enum(['manual', 'assistant', 'failure', 'planner_rule', 'user']).optional()
    })
  }),
  z.object({
    action: z.literal('set_status'),
    sessionId: SessionIdSchema,
    taskId: z.string().min(1).max(80),
    status: z.enum(['active', 'paused', 'done'])
  }),
  z.object({
    action: z.literal('delete'),
    sessionId: SessionIdSchema,
    taskId: z.string().min(1).max(80)
  }),
  z.object({
    action: z.literal('clear_done'),
    sessionId: SessionIdSchema
  }),
  z.object({
    action: z.literal('clear_all'),
    sessionId: SessionIdSchema
  }),
  z.object({
    action: z.literal('sync_insights'),
    sessionId: SessionIdSchema
  }),
  z.object({
    action: z.literal('migrate'),
    sessionId: SessionIdSchema,
    items: z.array(z.record(z.unknown())).max(24)
  }),
  z.object({
    action: z.literal('extract_llm'),
    sessionId: SessionIdSchema,
    assistantText: z.string().min(20).max(12000),
    userContext: z.string().max(4000).optional()
  })
])

export default defineEventHandler(async (event) => {
  if (getMethod(event) !== 'POST') {
    throw createError({ statusCode: 405, statusMessage: 'Method Not Allowed' })
  }
  const body = BodySchema.parse(await readBody(event))
  const policyDir = path.join(process.cwd(), '.data')
  const { sessionId } = body

  if (body.action === 'upsert') {
    const stack = await upsertTaskStackItem(policyDir, sessionId, body.task as Parameters<typeof upsertTaskStackItem>[2])
    return { ok: true, stack }
  }
  if (body.action === 'set_status') {
    const stack = await setTaskStackStatus(policyDir, sessionId, body.taskId, body.status as TaskStatus)
    return { ok: true, stack }
  }
  if (body.action === 'delete') {
    const stack = await deleteTaskStackItem(policyDir, sessionId, body.taskId)
    return { ok: true, stack }
  }
  if (body.action === 'clear_done') {
    const stack = await clearTaskStack(policyDir, sessionId, true)
    return { ok: true, stack }
  }
  if (body.action === 'clear_all') {
    const stack = await clearTaskStack(policyDir, sessionId, false)
    return { ok: true, stack }
  }
  if (body.action === 'sync_insights') {
    const r = await syncInsightLinkedTasks(policyDir, sessionId)
    return { ok: true, stack: r.stack, added: r.added }
  }
  if (body.action === 'migrate') {
    const r = await migrateTaskStackItems(policyDir, sessionId, body.items)
    return { ok: true, stack: r.stack, merged: r.merged }
  }
  if (body.action === 'extract_llm') {
    const r = await extractAndUpsertTasksFromAssistantText(
      policyDir,
      sessionId,
      body.assistantText,
      body.userContext
    )
    const stack = await loadTaskStack(policyDir, sessionId)
    return { ok: true, stack, added: r.added, skipped: r.skipped }
  }

  throw createError({ statusCode: 400, statusMessage: 'Unknown action' })
})
