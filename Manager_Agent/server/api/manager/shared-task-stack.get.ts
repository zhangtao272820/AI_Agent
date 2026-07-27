import path from 'node:path'
import { z } from 'zod'
import {
  isSharedTaskStackEnabled,
  isSharedTaskStackTokenValid,
  loadSharedTaskStackForUser
} from '../../graph/core/task/sharedTaskStack'
import { resolveUserId } from '../../graph/core/task/userIdentity'

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

/** 子 Agent / 外部入口：按 userId 读取跨会话合并任务栈 */
export default defineEventHandler(async (event) => {
  requireSharedTaskStackAccess(event)
  const query = getQuery(event)
  const userIdRaw = String(query.userId || query.user || '').trim()
  const sessionIdRaw = query.sessionId ? String(query.sessionId) : undefined

  const policyDir = path.join(process.cwd(), '.data')
  const userId = await resolveUserId(policyDir, sessionIdRaw, userIdRaw || undefined)
  if (!userId) {
    throw createError({ statusCode: 400, statusMessage: 'userId required' })
  }

  const view = await loadSharedTaskStackForUser(policyDir, userId)
  return { ok: true, ...view }
})
