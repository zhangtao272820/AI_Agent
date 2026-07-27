import { unwrapAgentCall } from '../../../utils/agents/agentResult'
import { buildMediaWebContext } from '../../../utils/search/managerWebSearch'
import { resolveExecutionQuery } from '../../core/routing/clauses'
import { emitSingleStepPlanEvent } from '../../core/plan/planStepsEvent'
import { buildMediaExecMessage } from '../../core/stepIsolation'
import { createExecContext } from './context'
import { compactStepInput } from './helpers'
import type { CreateExecutionNodesDeps } from './types'


export function buildVideoNode(deps: CreateExecutionNodesDeps) {
  const {
    ensureNotAborted,
    opts,
    lastUserText,
    appendMetrics,
    emitTrace,
    summarize,
    callVideoAgent,
    notifyAgentFailure
  } = createExecContext(deps)

  return async (state: any) => {
    ensureNotAborted()
    opts.sendEvent({ event: 'phase', data: 'execute:video', from: 'manager' })
    const raw = resolveExecutionQuery('video', state, lastUserText(state.messages))
    const meta = (state.meta as Record<string, unknown> | undefined) ?? null
    const prompt = buildMediaExecMessage('video', raw, lastUserText(state.messages), meta)
    emitSingleStepPlanEvent(opts, 'video', prompt)
    const webContext = buildMediaWebContext(meta)
    const t0 = Date.now()
    emitTrace({ type: 'step_start', agent: 'video', input: compactStepInput(prompt), at: new Date().toISOString() })
    try {
      const raw = await callVideoAgent({
        videoAgentWsUrl: opts.videoAgentWsUrl,
        timeoutMs: Math.min(Math.max(opts.timeoutMs, 180_000), 600_000),
        prompt,
        webContext: webContext ?? undefined,
        traceId: opts.runId,
        sendThinking: (t: string) => opts.sendEvent({ event: 'thinking', data: t, from: 'video' }),
        signal: opts.signal
      })
      const { answer, agentResult } = unwrapAgentCall(raw)
      await appendMetrics({ runId: opts.runId, phase: 'video', ms: Date.now() - t0 })
      const evidence = { kind: 'video' as const, query: prompt, agentResult }
      emitTrace({ type: 'step_end', agent: 'video', ms: Date.now() - t0, status: 'ok', evidence, outputSummary: summarize(answer), at: new Date().toISOString() })
      return { results: { video: answer }, evidence: [evidence] }
    } catch (e: any) {
      emitTrace({ type: 'step_end', agent: 'video', status: 'error', error: String(e?.message || e), at: new Date().toISOString() })
      notifyAgentFailure('video', String(e?.message || e))
      return { results: { video: `视频 Agent 不可用：${String(e?.message || e)}` } }
    }
  }

}
