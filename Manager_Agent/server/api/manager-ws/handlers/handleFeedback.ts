import type { WsHandlerContext, ParsedWsMessage } from './types'
import { fs, path, normalizeFeedbackScore, patchLearningSignalWithFeedback, maybeTuneLearningWeights } from './wsBarrel'

export async function handleFeedback(ctx: WsHandlerContext, payload: ParsedWsMessage) {
  const { peer, peerKey, send, sessionId, boundUserId, tenantId, explicitUserId, platformTraceId, payloadRaw } = ctx

const rid = payload.runId
    const score = payload.score ?? payload.rating ?? payload.value
    const uidx =
      typeof payload.userMessageIndex === 'number' && Number.isFinite(payload.userMessageIndex)
        ? Math.floor(payload.userMessageIndex)
        : null
    try {
      const dir = path.join(process.cwd(), '.data')
      await fs.mkdir(dir, { recursive: true }).catch(() => undefined)
      const fb = normalizeFeedbackScore(score)
      const p = path.join(dir, 'manager-memory.jsonl')
      const entry = {
        ts: new Date().toISOString(),
        type: 'feedback',
        sessionId,
        userId: boundUserId,
        runId: rid,
        userMessageIndex: uidx,
        score: fb,
        artifact: payload.artifact ?? null
      }
      await fs.appendFile(p, `${JSON.stringify(entry)}\n`, 'utf8')
      try {
        const { upsertSessionFeedback, userMessageFeedbackKey } = await import(
          '#agent-shared/sessionFeedbackStore'
        )
        const { normalizeArtifact } = await import('#agent-shared/artifactFeedbackPolicy')
        const { confirmRunArtifacts, revokeRunArtifacts } = await import(
          '#agent-shared/artifactFeedbackOrchestrator'
        )
        const artifact = normalizeArtifact(payload.artifact)
        const feedbackKey =
          uidx != null && uidx >= 0 ? userMessageFeedbackKey(uidx) : String(rid)
        await upsertSessionFeedback({
          agent: 'manager',
          sessionId,
          tenantId,
          feedbackKey,
          score: fb ?? 0,
          runId: String(rid),
          turnId: typeof payload.turnId === 'number' ? payload.turnId : null,
          userMessageIndex: uidx,
          artifact: artifact ?? undefined
        })
        let artifactResult: { promoted?: string[]; revoked?: string[] } = {}
        if (fb === 1) {
          artifactResult = await confirmRunArtifacts(String(rid), artifact).catch(() => ({ promoted: [] }))
        } else if (fb === 0) {
          artifactResult = await revokeRunArtifacts(String(rid), artifact).catch(() => ({ revoked: [] }))
        }
        const patched = await patchLearningSignalWithFeedback(dir, rid, fb).catch(() => ({ patched: false }))
        const tuned = await maybeTuneLearningWeights(dir).catch(() => ({ tuned: false }))
        send(
          'status',
          {
            status: 'feedback_saved',
            runId: rid,
            userMessageIndex: uidx ?? undefined,
            feedbackKey: uidx != null && uidx >= 0 ? userMessageFeedbackKey(uidx) : rid,
            feedbackScore: fb,
            learningPatched: patched.patched,
            compositeScore: patched.compositeScore,
            weightsTuned: tuned.tuned,
            weights: tuned.weights,
            artifactPromoted: artifactResult.promoted ?? [],
            artifactRevoked: artifactResult.revoked ?? [],
            note:
              fb === 1
                ? '已确认本轮产物；联邦经验与 SQL/检索/工具路径将在后续同类问题中优先复用。'
                : fb === 0
                  ? '已吊销本轮产物；相关 SQL/检索/工具路径已降权。'
                  : '反馈已记录。'
          },
          'manager',
          rid
        )
        return
      } catch {}
      const patched = await patchLearningSignalWithFeedback(dir, rid, fb).catch(() => ({ patched: false }))
      const tuned = await maybeTuneLearningWeights(dir).catch(() => ({ tuned: false }))
      send(
        'status',
        {
          status: 'feedback_saved',
          runId: rid,
          feedbackScore: fb,
          learningPatched: patched.patched,
          compositeScore: patched.compositeScore,
          weightsTuned: tuned.tuned,
          weights: tuned.weights,
          note: '反馈已记录（产物门控未启用或 PG 不可用）。'
        },
        'manager',
        rid
      )
    } catch (e: any) {
      send('status', { status: 'feedback_save_failed', error: String(e?.message || e || 'unknown error') }, 'manager', rid)
    }
    return
}
