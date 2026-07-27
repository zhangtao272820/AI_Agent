import type { WsHandlerContext, ParsedWsMessage } from './types'
import { readSession, sessions, writeSession, resolveUserMessageSessionIndex } from './wsBarrel'

export async function handleWithdrawTurn(ctx: WsHandlerContext, payload: ParsedWsMessage) {
  const { peer, peerKey, send, sessionId, boundUserId, tenantId, explicitUserId, platformTraceId, payloadRaw } = ctx

const userMessageIndex = payload.userMessageIndex
    let session = sessions.get(sessionId)
    if (!session) {
      session = await readSession(sessionId)
      sessions.set(sessionId, session)
    }
    const idx = resolveUserMessageSessionIndex(session.messages, userMessageIndex)
    if (idx < 0) {
      send('error', '找不到对应用户消息，无法撤回', 'manager')
      return
    }
    session.messages = session.messages.slice(0, idx)
    sessions.set(sessionId, session)
    await writeSession(sessionId, session)
    try {
      const { deleteSessionFeedbackFromUserIndex } = await import('#agent-shared/sessionFeedbackStore')
      await deleteSessionFeedbackFromUserIndex('manager', sessionId, userMessageIndex)
    } catch {}
    send(
      'status',
      {
        status: 'turn_withdrawn',
        userMessageIndex,
        messageCount: session.messages.length,
        userMessageCount: session.messages.filter((m) => m.role === 'user').length
      },
      'manager'
    )
    return
}
