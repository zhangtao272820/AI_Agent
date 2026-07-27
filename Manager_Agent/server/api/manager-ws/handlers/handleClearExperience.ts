import type { WsHandlerContext, ParsedWsMessage } from './types'


export async function handleClearExperience(ctx: WsHandlerContext, payload: ParsedWsMessage) {
  const { peer, peerKey, send, sessionId, boundUserId, tenantId, explicitUserId, platformTraceId, payloadRaw } = ctx

try {
      const { clearManagerExperience } = await import('../../../utils/session/managerMemoryClear')
      const res = await clearManagerExperience()
      send('status', { status: 'experience_cleared', removed: res.removed }, 'manager')
    } catch (e: any) {
      send('status', { status: 'experience_clear_failed', error: String(e?.message || e || 'unknown error') }, 'manager')
    }
    return
}
