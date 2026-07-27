import type { Intent } from '../../../utils/shared/taskPlan'
import { buildAgentError, emitAgentError, emitAgentEvidence } from '../../core/agent/agentErrors'
import { buildAgentExecutorBundle, executeDbStep, executeRagStep } from '../../core/executors'
import { resolveExecutionQuery } from '../../core/routing/clauses'
import { emitSingleStepPlanEvent } from '../../core/plan/planStepsEvent'
import { emitStepResultEvent } from '../../core/output/stepResultEvent'
import type { ManagerGraphState } from '../../state/state'
import { createExecContext } from './context'
import { compactStepInput } from './helpers'
import type { CreateExecutionNodesDeps } from './types'


export function buildRagNode(deps: CreateExecutionNodesDeps) {
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
    ragEvidenceFromProbe,
    probeRagEvidence,
    mergeTaskPlan,
    getEffectivePlanSteps,
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
    ragScopeHintJudge,
    llmInvoke
  } = createExecContext(deps)

  return async (state: any) => {
    ensureNotAborted()
    opts.sendEvent({ event: 'phase', data: 'execute:rag', from: 'manager' })
    const lastOnly = lastUserText(state.messages)
    const qt = resolveExecutionQuery('rag', state, lastOnly)
    emitSingleStepPlanEvent(opts, 'rag', qt)
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
        ragScopeHintJudge,
        lastUserText,
        ragEvidenceFromProbe
      },
      {
        runId: opts.runId,
        sessionId: opts.sessionId,
        timeoutMs: opts.timeoutMs,
        signal: opts.signal,
        dbAgentWsUrl: opts.dbAgentWsUrl,
        dbAgentHttpUrl: opts.dbAgentHttpUrl,
        dbId: opts.dbId,
        ragAgentHttpUrl: opts.ragAgentHttpUrl,
        ragHistory: opts.ragHistory,
        ragConversationId: opts.ragConversationId,
        userId: opts.userId,
        codeAgentWsUrl: opts.codeAgentWsUrl,
        crawlerAgentWsUrl: opts.crawlerAgentWsUrl,
        lobsterAgentWsUrl: opts.lobsterAgentWsUrl,
        aiAdminAgentWsUrl: opts.aiAdminAgentWsUrl,
        multimodalAgentHttpUrl: opts.multimodalAgentHttpUrl,
        musicAgentWsUrl: opts.musicAgentWsUrl,
        videoAgentWsUrl: opts.videoAgentWsUrl,
        sendEvent: opts.sendEvent
      }
    )
    try {
      const t0 = Date.now()
      emitTrace({ type: 'step_start', agent: 'rag', input: compactStepInput(qt), at: new Date().toISOString() })
      const outcome = await executeRagStep(execDeps, execOpts, {
        state: state as ManagerGraphState,
        question: lastOnly,
        baseQuery: qt,
        effQuery: qt,
        timeoutMs: Math.min(opts.timeoutMs, 45000),
        sendThinking: (t: string) => opts.sendEvent({ event: 'thinking', data: t, from: 'rag' }),
        allowRetry: true
      })
      if (!outcome.ok) throw new Error(outcome.error)
      const ragAnswer = outcome.output
      const ragEvidence = outcome.evidence
      await appendMetrics({ runId: opts.runId, phase: 'rag', ms: Date.now() - t0 })
      emitStepResultEvent(opts, { stepId: 'step_rag', agent: 'rag', outcome, ms: Date.now() - t0 })
      emitTrace({ type: 'step_end', agent: 'rag', ms: Date.now() - t0, status: 'ok', evidence: ragEvidence, outputSummary: summarize(ragAnswer), at: new Date().toISOString() })
      emitAgentEvidence(opts.sendEvent, 'rag', ragEvidence as Record<string, unknown>)
      const needsClarify = Boolean(outcome.clarifyQuestions?.length)
      return {
        results: { rag: ragAnswer },
        evidence: ragEvidence ? [ragEvidence] : [],
        meta: needsClarify
          ? mergeMeta(state, { needsClarify: true, clarifyQuestions: outcome.clarifyQuestions, uncertainty: 'high' })
          : undefined,
        taskPlan: needsClarify
          ? mergeTaskPlan(
              state.taskPlan ?? null,
              { needsClarification: true, clarificationQuestions: outcome.clarifyQuestions },
              'rag',
              getEffectivePlanSteps(state as any)
            )
          : (state.taskPlan ?? null)
      }
    } catch (e: any) {
      emitTrace({ type: 'step_end', agent: 'rag', status: 'error', error: String(e?.message || e), at: new Date().toISOString() })
      emitAgentError(
        opts.sendEvent,
        buildAgentError({ agent: 'rag', message: String(e?.message || e), phase: 'execute', runId: opts.runId })
      )
      opts.sendEvent({ event: 'thinking', data: `RAG Agent 不可用，尝试改用数据库 Agent：${String(e?.message || e)}`, from: 'manager' })
      const t0 = Date.now()
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
          lastUserText,
          ragEvidenceFromProbe
        },
        {
          runId: opts.runId,
          sessionId: opts.sessionId,
          timeoutMs: opts.timeoutMs,
          signal: opts.signal,
          dbAgentWsUrl: opts.dbAgentWsUrl,
          dbAgentHttpUrl: opts.dbAgentHttpUrl,
          dbId: opts.dbId,
          ragAgentHttpUrl: opts.ragAgentHttpUrl,
          codeAgentWsUrl: opts.codeAgentWsUrl,
          crawlerAgentWsUrl: opts.crawlerAgentWsUrl,
          lobsterAgentWsUrl: opts.lobsterAgentWsUrl,
          aiAdminAgentWsUrl: opts.aiAdminAgentWsUrl,
          sendEvent: opts.sendEvent
        }
      )
      emitTrace({ type: 'step_start', agent: 'db', input: compactStepInput(qt), at: new Date().toISOString() })
      const dbOutcome = await executeDbStep(execDeps, execOpts, {
        state: state as ManagerGraphState,
        effQuery: qt,
        timeoutMs: opts.timeoutMs,
        sendThinking: (t: string) => opts.sendEvent({ event: 'thinking', data: t, from: 'db' }),
        llmInvoke
      })
      await appendMetrics({ runId: opts.runId, phase: 'db', ms: Date.now() - t0 })
      if (!dbOutcome.ok) {
        throw new Error(dbOutcome.error || 'db fallback failed')
      }
      const dbEvidence = dbOutcome.evidence ?? { kind: 'db', query: qt }
      emitTrace({ type: 'step_end', agent: 'db', ms: Date.now() - t0, status: 'ok', evidence: dbEvidence, outputSummary: summarize(String(dbOutcome.output ?? '')), at: new Date().toISOString() })
      return { results: { db: String(dbOutcome.output ?? '') }, intent: 'db' as Intent, evidence: [dbEvidence] }
    }
  }

}
