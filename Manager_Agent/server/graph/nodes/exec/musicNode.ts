import { unwrapAgentCall } from '../../../utils/agents/agentResult'
import { buildMediaWebContext } from '../../../utils/search/managerWebSearch'
import { resolveExecutionQuery } from '../../core/routing/clauses'
import { emitSingleStepPlanEvent } from '../../core/plan/planStepsEvent'
import { buildMediaExecMessage } from '../../core/stepIsolation'
import { createExecContext } from './context'
import { compactStepInput } from './helpers'
import type { CreateExecutionNodesDeps } from './types'


export function buildMusicNode(deps: CreateExecutionNodesDeps) {
  const {
    ensureNotAborted,
    opts,
    lastUserText,
    appendMetrics,
    emitTrace,
    summarize,
    callMusicAgent,
    notifyAgentFailure
  } = createExecContext(deps)

  return async (state: any) => {
    ensureNotAborted()
    opts.sendEvent({ event: 'phase', data: 'execute:music', from: 'manager' })
    const raw = resolveExecutionQuery('music', state, lastUserText(state.messages))
    const meta = (state.meta as Record<string, unknown> | undefined) ?? null
    const prompt = buildMediaExecMessage('music', raw, lastUserText(state.messages), meta)
    emitSingleStepPlanEvent(opts, 'music', prompt)
    const webContext = buildMediaWebContext(meta)
    const t0 = Date.now()
    emitTrace({ type: 'step_start', agent: 'music', input: compactStepInput(prompt), at: new Date().toISOString() })
    try {
      const raw = await callMusicAgent({
        musicAgentWsUrl: opts.musicAgentWsUrl,
        timeoutMs: Math.min(Math.max(opts.timeoutMs, 120_000), 300_000),
        prompt,
        webContext: webContext ?? undefined,
        traceId: opts.runId,
        sendThinking: (t: string) => opts.sendEvent({ event: 'thinking', data: t, from: 'music' }),
        signal: opts.signal
      })
      const { answer, agentResult } = unwrapAgentCall(raw)
      await appendMetrics({ runId: opts.runId, phase: 'music', ms: Date.now() - t0 })
      const evidence = { kind: 'music' as const, query: prompt, agentResult }
      emitTrace({ type: 'step_end', agent: 'music', ms: Date.now() - t0, status: 'ok', evidence, outputSummary: summarize(answer), at: new Date().toISOString() })
      return { results: { music: answer }, evidence: [evidence] }
    } catch (e: any) {
      emitTrace({ type: 'step_end', agent: 'music', status: 'error', error: String(e?.message || e), at: new Date().toISOString() })
      notifyAgentFailure('music', String(e?.message || e))
      return { results: { music: `音乐 Agent 不可用：${String(e?.message || e)}` } }
    }
  }

}
