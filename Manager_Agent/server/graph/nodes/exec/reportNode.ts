import { resolveCodeAuthorityPayload } from '#agent-shared/codeAuthorityPayload'
import { tryDeterministicDownstreamOutput } from '#agent-shared/codeDownstreamOutput'
import { hasCodeInResults, buildCodeFirstBundle } from '#agent-shared/codeFirstAuthority'
import { gateReportOutput } from '#agent-shared/reportGate'
import { shouldDeferReportToSynth, deferredReportEvidence } from '#agent-shared/reportSynthDefer'
import { createCodeAuthorityLlmModel } from '../../../utils/code/managerCodeAuthorityLlm'
import { tryCodeAuthorityDownstreamOutput } from '../../../utils/code/managerCodeDownstream'
import { resolveExecutionQuery } from '../../core/routing/clauses'
import { emitCollabPreview } from '../../core/plan/collabPreview'
import { buildReportAgentContext } from '../../core/output/downstreamContext'
import { recordDownstreamMetric } from '../../core/output/downstreamMetrics'
import { emitSingleStepPlanEvent } from '../../core/plan/planStepsEvent'
import { extractStructuredPayload } from '../../core/shared'
import { createExecContext } from './context'
import { compactStepInput } from './helpers'
import type { CreateExecutionNodesDeps } from './types'


export function buildReportNode(deps: CreateExecutionNodesDeps) {
  const {
    ensureNotAborted,
    opts,
    lastUserText,
    appendMetrics,
    emitTrace,
    summarize,
    runInternalAgent
  } = createExecContext(deps)

  return async (state: any) => {
    ensureNotAborted()
    opts.sendEvent({ event: 'phase', data: 'execute:report', from: 'manager' })
    const question = resolveExecutionQuery('report', state, lastUserText(state.messages))
    emitSingleStepPlanEvent(opts, 'report', question)
    const t0 = Date.now()
    emitTrace({ type: 'step_start', agent: 'report', input: compactStepInput(question), at: new Date().toISOString() })
    const mergedResults = (state.results || {}) as Record<string, unknown>
    const shapeCtx = { meta: state.meta, planSteps: state.plan }
    if (shouldDeferReportToSynth(mergedResults, shapeCtx)) {
      await appendMetrics({ runId: opts.runId, phase: 'report', ms: Date.now() - t0 })
      const reportEvidence = deferredReportEvidence(question)
      emitTrace({
        type: 'step_end',
        agent: 'report',
        ms: Date.now() - t0,
        status: 'ok',
        evidence: reportEvidence,
        outputSummary: 'deferred_to_synth',
        at: new Date().toISOString()
      })
      opts.sendEvent({
        event: 'thinking',
        data: 'Report：叙述性报告由 Synth 流式生成（跳过 report LLM）',
        from: 'manager'
      })
      return { results: {}, evidence: [reportEvidence], resources: state.resources, meta: state.meta }
    }
    if (hasCodeInResults(mergedResults)) {
      const codeModel = createCodeAuthorityLlmModel({
        openaiApiKey: opts.openaiApiKey,
        openaiBaseUrl: opts.openaiBaseUrl,
        modelName: String(state.resources?.modelLowCost ?? opts.openaiModel ?? '')
      })
      const auth = await tryCodeAuthorityDownstreamOutput(
        'report',
        mergedResults,
        extractStructuredPayload,
        question,
        codeModel,
        shapeCtx
      )
      if (auth) {
        void recordDownstreamMetric({
          runId: opts.runId,
          kind: 'report',
          ok: true,
          mode: auth.mode,
          evidenceCoverage: auth.evidenceCoverage,
          ms: Date.now() - t0
        })
        await appendMetrics({ runId: opts.runId, phase: 'report', ms: Date.now() - t0 })
        const reportEvidence = { kind: 'report' as const, query: question, mode: auth.mode }
        emitTrace({ type: 'step_end', agent: 'report', ms: Date.now() - t0, status: 'ok', evidence: reportEvidence, outputSummary: summarize(auth.output), at: new Date().toISOString() })
        emitCollabPreview(opts.sendEvent, 'report', auth.output, auth.mode)
        return { results: { report: auth.output }, evidence: [reportEvidence], resources: state.resources, meta: state.meta }
      }
    }
    const det = tryDeterministicDownstreamOutput('report', mergedResults, extractStructuredPayload, shapeCtx)
    if (det) {
      const payload = resolveCodeAuthorityPayload(mergedResults, extractStructuredPayload)
      const banner = buildCodeFirstBundle({
        results: mergedResults,
        extractPayload: extractStructuredPayload,
        maxCodeChars: 400,
        maxRefChars: 0
      }).authorityBanner
      const gated = payload ? gateReportOutput(payload, det, banner, question) : { output: det, ok: true, coverage: 1, mode: 'original' as const }
      if (payload && !gated.ok) {
        void recordDownstreamMetric({
          runId: opts.runId,
          kind: 'report',
          ok: false,
          reason: gated.reason,
          ms: Date.now() - t0
        })
      } else {
        void recordDownstreamMetric({
          runId: opts.runId,
          kind: 'report',
          ok: true,
          mode: 'code_authority_deterministic',
          evidenceCoverage: gated.coverage,
          ms: Date.now() - t0
        })
      }
      await appendMetrics({ runId: opts.runId, phase: 'report', ms: Date.now() - t0 })
      const mode = String(mergedResults.code ?? '').trim()
        ? 'code_authority_deterministic'
        : 'db_authority_deterministic'
      const reportEvidence = { kind: 'report' as const, query: question, mode }
      emitTrace({ type: 'step_end', agent: 'report', ms: Date.now() - t0, status: gated.ok ? 'ok' : 'warn', evidence: reportEvidence, outputSummary: summarize(gated.output), at: new Date().toISOString() })
      opts.sendEvent({
        event: 'thinking',
        data: mode === 'db_authority_deterministic' ? 'Report：单源 DB，确定性报告（跳过 LLM）' : 'Report：Code/DB 权威数据，确定性报告（跳过 LLM）',
        from: 'manager'
      })
      if (payload && !gated.ok) {
        emitCollabPreview(opts.sendEvent, 'report', gated.output, mode)
        return { results: { report: gated.output }, evidence: [reportEvidence], resources: state.resources, meta: state.meta }
      }
      emitCollabPreview(opts.sendEvent, 'report', gated.output, mode)
      return { results: { report: gated.output }, evidence: [reportEvidence], resources: state.resources, meta: state.meta }
    }
    const context = buildReportAgentContext(mergedResults, extractStructuredPayload)
    const out = await runInternalAgent('report', question, state, context)
    const answer = typeof out === 'string' ? out : out.answer
    await appendMetrics({ runId: opts.runId, phase: 'report', ms: Date.now() - t0 })
    const reportEvidence = { kind: 'report' as const, query: question }
    emitTrace({ type: 'step_end', agent: 'report', ms: Date.now() - t0, status: 'ok', evidence: reportEvidence, outputSummary: summarize(answer), at: new Date().toISOString() })
    emitCollabPreview(opts.sendEvent, 'report', answer)
    return { results: { report: answer }, evidence: [reportEvidence], resources: typeof out === 'string' ? state.resources : out.resources, meta: typeof out === 'string' ? state.meta : out.meta }
  }

}
