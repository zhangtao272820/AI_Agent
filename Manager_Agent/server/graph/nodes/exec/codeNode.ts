import { buildCodeFixHintFromMeta, parseCodeClarifyFromMeta } from '../../../utils/code/managerCodeMeta'
import { buildAgentExecutorBundle, executeCodeStep } from '../../core/executors'
import { resolveExecutionQuery } from '../../core/routing/clauses'
import { emitSingleStepPlanEvent } from '../../core/plan/planStepsEvent'
import type { ManagerGraphState } from '../../state/state'
import { createExecContext } from './context'
import { compactStepInput } from './helpers'
import type { CreateExecutionNodesDeps } from './types'


export function buildCodeNode(deps: CreateExecutionNodesDeps) {
  const {
    ensureNotAborted,
    opts,
    lastUserText,
    callDbAgent,
    appendMetrics,
    isDbNoData,
    emitTrace,
    summarize,
    callRagAgent,
    probeRagEvidence,
    mergeMeta,
    callCodeAgent,
    callAiAdminAgent,
    callCrawlerAgent,
    callLobsterAgent,
    filterCrawlerResultDomestic,
    callMultimodalAgent,
    callMusicAgent,
    callVideoAgent,
    ragRelevanceJudge,
    ragEvidenceMatchJudge,
    notifyAgentFailure
  } = createExecContext(deps)

  return async (state: any) => {
    ensureNotAborted()
    opts.sendEvent({ event: 'phase', data: 'execute:code', from: 'manager' })
    const question = resolveExecutionQuery('code', state, lastUserText(state.messages))
    emitSingleStepPlanEvent(opts, 'code', question)
    const codeMessage = compactStepInput(question, 220)
    const t0 = Date.now()
    emitTrace({ type: 'step_start', agent: 'code', input: codeMessage, at: new Date().toISOString() })
    const { deps: execDeps, opts: execOpts } = buildAgentExecutorBundle(
      {
        callDbAgent,
        callRagAgent,
        callCrawlerAgent,
        callLobsterAgent,
        callCodeAgent,
        callAiAdminAgent,
        callMultimodalAgent,
        callMusicAgent,
        callVideoAgent,
        probeRagEvidence,
        filterCrawlerResultDomestic,
        isDbNoData,
        ragRelevanceJudge,
        ragEvidenceMatchJudge,
        lastUserText
      },
      {
        runId: opts.runId,
        sessionId: opts.sessionId,
        threadId: opts.threadId,
        timeoutMs: opts.timeoutMs,
        signal: opts.signal,
        codeAgentWsUrl: opts.codeAgentWsUrl,
        dbAgentWsUrl: opts.dbAgentWsUrl,
        dbAgentHttpUrl: opts.dbAgentHttpUrl,
        ragAgentHttpUrl: opts.ragAgentHttpUrl,
        crawlerAgentWsUrl: opts.crawlerAgentWsUrl,
        lobsterAgentWsUrl: opts.lobsterAgentWsUrl,
        aiAdminAgentWsUrl: opts.aiAdminAgentWsUrl,
        multimodalAgentHttpUrl: opts.multimodalAgentHttpUrl,
        musicAgentWsUrl: opts.musicAgentWsUrl,
        videoAgentWsUrl: opts.videoAgentWsUrl,
        sendEvent: opts.sendEvent
      }
    )
    const outcome = await executeCodeStep(execDeps, execOpts, {
      state: state as ManagerGraphState,
      effQuery: question,
      out: (state.results || {}) as Record<string, string>,
      timeoutMs: opts.timeoutMs,
      message: codeMessage,
      sendThinking: (t: string) => opts.sendEvent({ event: 'thinking', data: t, from: 'code' }),
      sendDelta: (d: string) => opts.sendEvent({ event: 'delta', data: d, from: 'code' })
    })
    await appendMetrics({
      runId: opts.runId,
      phase: 'code',
      ms: Date.now() - t0,
      extra:
        outcome.ok && outcome.evidence && (outcome.evidence as { transportMetrics?: unknown }).transportMetrics
          ? {
              step_ms: Date.now() - t0,
              ...(outcome.evidence as { transportMetrics: Record<string, unknown> }).transportMetrics
            }
          : { step_ms: Date.now() - t0 }
    })
    const codeMeta = outcome.ok ? (outcome.meta as Parameters<typeof parseCodeClarifyFromMeta>[0]) : undefined
    const codeEvidence = outcome.ok && outcome.evidence
      ? outcome.evidence
      : { kind: 'code' as const, query: question, threadId: opts.threadId }
    emitTrace({
      type: 'step_end',
      agent: 'code',
      ms: Date.now() - t0,
      status: outcome.ok ? 'ok' : 'error',
      evidence: codeEvidence,
      outputSummary: summarize(outcome.output),
      error: outcome.ok ? undefined : outcome.error,
      at: new Date().toISOString()
    })
    if (!outcome.ok) {
      notifyAgentFailure('code', String(outcome.error || 'code step failed'))
      return { results: { code: outcome.output }, evidence: [codeEvidence] }
    }
    const codeClarify = parseCodeClarifyFromMeta(codeMeta)
    if (codeClarify.needsClarify) {
      return {
        results: { code: outcome.output },
        evidence: [codeEvidence],
        meta: mergeMeta(state, {
          needsClarify: true,
          clarifyQuestions: codeClarify.questions,
          uncertainty: 'high',
          ...(codeClarify.chips.length ? { clarifyChips: codeClarify.chips } : {})
        })
      }
    }
    const metaPatch: Record<string, unknown> = {}
    if (codeMeta && (codeMeta as { validate_ok?: boolean }).validate_ok === false) {
      metaPatch.uncertainty = 'medium'
      const hint = buildCodeFixHintFromMeta(codeMeta)
      if (hint) metaPatch.fixHint = hint
    }
    return {
      results: { code: outcome.output },
      evidence: [codeEvidence],
      ...(Object.keys(metaPatch).length ? { meta: mergeMeta(state, metaPatch) } : {})
    }
  }

}
