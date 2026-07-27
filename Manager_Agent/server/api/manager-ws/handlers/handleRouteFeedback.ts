import type { WsHandlerContext, ParsedWsMessage } from './types'


export async function handleRouteFeedback(ctx: WsHandlerContext, payload: ParsedWsMessage) {
  const { peer, peerKey, send, sessionId, boundUserId, tenantId, explicitUserId, platformTraceId, payloadRaw } = ctx

const rid = payload.runId
    const uidx =
      typeof payload.userMessageIndex === 'number' && Number.isFinite(payload.userMessageIndex)
        ? Math.floor(payload.userMessageIndex)
        : null
    try {
      const { appendRouteWrongFeedback } = await import('../../../utils/route/managerRouteFeedbackStore')
      await appendRouteWrongFeedback({
        sessionId,
        userId: boundUserId,
        runId: String(rid),
        turnId: typeof payload.turnId === 'number' ? payload.turnId : undefined,
        userMessageIndex: uidx ?? undefined,
        comment: payload.comment ? String(payload.comment).slice(0, 800) : '路由不对',
        userTask: payload.userTask ? String(payload.userTask).slice(0, 2000) : undefined,
        cap: Array.isArray(payload.cap) ? payload.cap.map(String) : undefined,
        intent: payload.intent ? String(payload.intent) : undefined,
        orchestratorSource: payload.orchestratorSource ? String(payload.orchestratorSource) : undefined,
        lintIssues: Array.isArray(payload.lintIssues) ? payload.lintIssues.map(String) : undefined
      })
      if (uidx != null && uidx >= 0) {
        try {
          const { upsertSessionFeedback, routeWrongFeedbackKey } = await import(
            '#agent-shared/sessionFeedbackStore'
          )
          await upsertSessionFeedback({
            agent: 'manager',
            sessionId,
            tenantId,
            feedbackKey: routeWrongFeedbackKey(uidx),
            score: 0,
            userMessageIndex: uidx,
            runId: rid ? String(rid) : null,
            turnId: typeof payload.turnId === 'number' ? payload.turnId : null,
            comment: 'route_wrong',
            artifact: {
              routeWrong: true,
              cap: Array.isArray(payload.cap) ? payload.cap : undefined,
              intent: payload.intent ? String(payload.intent) : undefined
            }
          })
        } catch {
          /* optional PG */
        }
      }
      send(
        'status',
        {
          status: 'route_feedback_saved',
          runId: rid,
          userMessageIndex: uidx ?? undefined,
          note: '已记录路由纠错反馈，将进入人工/CI 复核队列（不直接改 Bandit）。'
        },
        'manager',
        rid
      )
    } catch (e: any) {
      send(
        'status',
        { status: 'route_feedback_failed', runId: rid, error: String(e?.message || e || 'unknown error') },
        'manager',
        rid
      )
    }
    return
}
