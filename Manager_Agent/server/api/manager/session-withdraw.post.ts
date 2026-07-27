import path from 'node:path'
import { z } from 'zod'
import { readManagerSession, writeManagerSession } from '../../utils/session/managerSessionStore'
import { resolveUserId } from '../../graph/core/task/userIdentity'
import { deleteSessionFeedbackFromUserIndex } from '#agent-shared/sessionFeedbackStore'

const BodySchema = z.object({
  sessionId: z.string().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/),
  userId: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/).optional(),
  userMessageIndex: z.number().int().min(0).max(199)
})

type SessionMessage = { role: 'user' | 'assistant'; content: string }

function resolveUserMessageSessionIndex(messages: SessionMessage[], userMessageIndex: number): number {
  if (!Array.isArray(messages) || userMessageIndex < 0) return -1
  let nth = 0
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]?.role === 'user') {
      if (nth === userMessageIndex) return i
      nth++
    }
  }
  return -1
}

async function readSession(sessionId: string): Promise<{ messages: SessionMessage[] }> {
  return readManagerSession(sessionId)
}

async function writeSession(sessionId: string, messages: SessionMessage[]) {
  await writeManagerSession(sessionId, { messages })
}

export default defineEventHandler(async (event) => {
  const body = BodySchema.parse(await readBody(event))
  const policyDir = path.join(process.cwd(), '.data')
  await resolveUserId(policyDir, body.sessionId, body.userId)

  const session = await readSession(body.sessionId)
  const idx = resolveUserMessageSessionIndex(session.messages, body.userMessageIndex)
  if (idx < 0) {
    throw createError({ statusCode: 404, statusMessage: '找不到对应用户消息，无法撤回' })
  }

  session.messages = session.messages.slice(0, idx)
  await writeSession(body.sessionId, session.messages)
  const feedbackDeleted = await deleteSessionFeedbackFromUserIndex(
    'manager',
    body.sessionId,
    body.userMessageIndex
  )

  return {
    ok: true,
    userMessageIndex: body.userMessageIndex,
    messageCount: session.messages.length,
    userMessageCount: session.messages.filter((m) => m.role === 'user').length,
    feedbackDeleted
  }
})
