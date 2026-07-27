import type { WsHandlerContext, ParsedWsMessage } from './types'
import {
  path,
  readSession,
  sessions,
  refreshProactiveNudgesForSession,
  isProactiveLoopEnabled,
  drainPendingAutonomousResults,
  isAutonomousWsNotifyEnabled
} from './wsBarrel'

export async function handleResume(ctx: WsHandlerContext, payload: ParsedWsMessage) {
  const { peer, peerKey, send, sessionId, boundUserId, tenantId, explicitUserId, platformTraceId, payloadRaw } = ctx

const s = await readSession(sessionId)
    sessions.set(sessionId, s)
    send(
      'status',
      {
        status: 'resumed',
        messages: s.messages.length,
        userMessageCount: s.messages.filter((m) => m.role === 'user').length,
        chatHistory: s.messages.slice(-80),
        userId: boundUserId,
        tenantId
      },
      'manager'
    )
    if (isProactiveLoopEnabled()) {
      const nudges = await refreshProactiveNudgesForSession(
        path.join(process.cwd(), '.data'),
        sessionId
      ).catch(() => [])
      if (nudges.length) send('proactive_nudge', { nudges }, 'manager')
    }
    if (isAutonomousWsNotifyEnabled()) {
      const pending = await drainPendingAutonomousResults(path.join(process.cwd(), '.data'), sessionId).catch(
        () => []
      )
      for (const row of pending) {
        send('autonomous_result', row, 'manager', `auto-${row.jobId}`)
      }
    }
    return
}
