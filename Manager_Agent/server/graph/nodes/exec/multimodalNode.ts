import { unwrapAgentCall } from '../../../utils/agents/agentResult'
import { sanitizeVisionAnswer } from '../../../utils/media/managerVisionSanitize'
import { resolveExecutionQuery } from '../../core/routing/clauses'
import { emitSingleStepPlanEvent } from '../../core/plan/planStepsEvent'
import { buildMediaExecMessage } from '../../core/stepIsolation'
import { createExecContext } from './context'
import { compactStepInput } from './helpers'
import type { CreateExecutionNodesDeps } from './types'


export function buildMultimodalNode(deps: CreateExecutionNodesDeps) {
  const {
    ensureNotAborted,
    opts,
    lastUserText,
    appendMetrics,
    emitTrace,
    summarize,
    callMultimodalAgent,
    notifyAgentFailure
  } = createExecContext(deps)

  return async (state: any) => {
    ensureNotAborted()
    opts.sendEvent({ event: 'phase', data: 'execute:multimodal', from: 'manager' })
    const raw = resolveExecutionQuery('multimodal', state, lastUserText(state.messages))
    const meta = (state.meta as Record<string, unknown> | undefined) ?? null
    const query = buildMediaExecMessage('multimodal', raw, lastUserText(state.messages), meta)
    emitSingleStepPlanEvent(opts, 'multimodal', query)
    const t0 = Date.now()
    emitTrace({ type: 'step_start', agent: 'multimodal', input: compactStepInput(query), at: new Date().toISOString() })
    try {
      const att = state.mediaAttachment
      const raw = await callMultimodalAgent({
        multimodalAgentHttpUrl: opts.multimodalAgentHttpUrl,
        timeoutMs: Math.min(opts.timeoutMs, 120_000),
        query,
        action: 'understand',
        filePath: att?.filePath,
        mediaType: att?.mediaType || 'image',
        traceId: opts.runId,
        signal: opts.signal
      })
      const { answer, agentResult } = unwrapAgentCall(raw)
      const userTask = lastUserText(state.messages)
      const safeAnswer = sanitizeVisionAnswer(String(answer ?? ''), userTask)
      await appendMetrics({ runId: opts.runId, phase: 'multimodal', ms: Date.now() - t0 })
      const evidence = { kind: 'multimodal' as const, query, action: 'understand', agentResult }
      emitTrace({
        type: 'step_end',
        agent: 'multimodal',
        ms: Date.now() - t0,
        status: 'ok',
        evidence,
        outputSummary: summarize(safeAnswer),
        at: new Date().toISOString()
      })
      return { results: { multimodal: safeAnswer }, evidence: [evidence] }
    } catch (e: any) {
      emitTrace({
        type: 'step_end',
        agent: 'multimodal',
        status: 'error',
        error: String(e?.message || e),
        at: new Date().toISOString()
      })
      notifyAgentFailure('multimodal', String(e?.message || e))
      opts.sendEvent({ event: 'thinking', data: `多模态 Agent：${String(e?.message || e)}`, from: 'manager' })
      return { results: { multimodal: `多模态服务暂不可用：${String(e?.message || e)}` } }
    }
  }

}
