import path from 'node:path'
import { z } from 'zod'
import { sanitizeSessionTitle, writeSessionMeta } from '../../utils/session/managerSessionMeta'
import { bindSessionToUser, resolveUserId } from '../../graph/core/task/userIdentity'

const BodySchema = z.object({
  sessionId: z.string().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/),
  userId: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/).optional(),
  title: z.string().min(1).max(80)
})

export default defineEventHandler(async (event) => {
  const body = BodySchema.parse(await readBody(event))
  const policyDir = path.join(process.cwd(), '.data')
  const userId = await resolveUserId(policyDir, body.sessionId, body.userId)
  if (!userId) {
    throw createError({ statusCode: 403, statusMessage: '无法验证会话归属' })
  }

  const title = sanitizeSessionTitle(body.title)
  if (!title) {
    throw createError({ statusCode: 400, statusMessage: '标题不能为空' })
  }

  const dataRoot = path.join(process.cwd(), '.data')
  await bindSessionToUser(policyDir, body.sessionId, userId)
  await writeSessionMeta(dataRoot, body.sessionId, { title, customTitle: true })

  return { ok: true, sessionId: body.sessionId, title, customTitle: true }
})
