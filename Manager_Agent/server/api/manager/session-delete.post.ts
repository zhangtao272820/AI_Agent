import path from 'node:path'
import { z } from 'zod'
import { deleteSessionArtifacts } from '../../utils/session/managerSessionMeta'
import { deleteManagerSession } from '../../utils/session/managerSessionStore'
import { bindSessionToUser, removeSessionFromUserMap, sanitizeUserId } from '../../graph/core/task/userIdentity'
import { deleteAllSessionFeedback } from '#agent-shared/sessionFeedbackStore'

const BodySchema = z.object({
  sessionId: z.string().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/),
  userId: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/).optional()
})

export default defineEventHandler(async (event) => {
  const body = BodySchema.parse(await readBody(event))
  const policyDir = path.join(process.cwd(), '.data')
  const explicit = sanitizeUserId(body.userId)
  if (!explicit) {
    throw createError({ statusCode: 400, statusMessage: '缺少有效 userId' })
  }
  await bindSessionToUser(policyDir, body.sessionId, explicit)

  const pgDelete = await deleteManagerSession(body.sessionId)
  await deleteSessionArtifacts({
    cwd: process.cwd(),
    policyDir,
    sessionId: body.sessionId
  })
  await removeSessionFromUserMap(policyDir, body.sessionId)
  const feedbackDeleted = await deleteAllSessionFeedback('manager', body.sessionId)

  return { ok: true, sessionId: body.sessionId, pgDeleted: pgDelete.pg, feedbackDeleted }
})
