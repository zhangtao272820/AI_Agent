import { buildAgentExecutorBundle, executeCrawlerStep, isCrawlerResultEmpty } from '../../core/executors'
import { resolveExecutionQuery } from '../../core/routing/clauses'
import { emitSingleStepPlanEvent } from '../../core/plan/planStepsEvent'
import type { ManagerGraphState } from '../../state/state'
import { createExecContext } from './context'
import { compactStepInput } from './helpers'
import type { CreateExecutionNodesDeps } from './types'


export function buildCrawlerNode(deps: CreateExecutionNodesDeps) {
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
    mergeTaskPlan,
    getEffectivePlanSteps,
    mergeMeta,
    callCodeAgent,
    callAiAdminAgent,
    callCrawlerAgent,
    callLobsterAgent,
    crawlerTaskPlanPatch,
    filterCrawlerResultDomestic,
    callMultimodalAgent,
    callMusicAgent,
    callVideoAgent,
    ragRelevanceJudge,
    ragEvidenceMatchJudge,
    llmInvoke,
    notifyAgentFailure
  } = createExecContext(deps)

  return async (state: any) => {
    ensureNotAborted()
    opts.sendEvent({ event: 'phase', data: 'execute:crawler', from: 'manager' })
    const question = resolveExecutionQuery('crawler', state, lastUserText(state.messages))
    emitSingleStepPlanEvent(opts, 'crawler', question)
    const t0 = Date.now()
    emitTrace({ type: 'step_start', agent: 'crawler', input: compactStepInput(question), at: new Date().toISOString() })
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
        timeoutMs: opts.timeoutMs,
        signal: opts.signal,
        crawlerAgentWsUrl: opts.crawlerAgentWsUrl,
        lobsterAgentWsUrl: opts.lobsterAgentWsUrl,
        dbAgentWsUrl: opts.dbAgentWsUrl,
        dbAgentHttpUrl: opts.dbAgentHttpUrl,
        ragAgentHttpUrl: opts.ragAgentHttpUrl,
        codeAgentWsUrl: opts.codeAgentWsUrl,
        aiAdminAgentWsUrl: opts.aiAdminAgentWsUrl,
        multimodalAgentHttpUrl: opts.multimodalAgentHttpUrl,
        musicAgentWsUrl: opts.musicAgentWsUrl,
        videoAgentWsUrl: opts.videoAgentWsUrl,
        sendEvent: opts.sendEvent
      }
    )
    const outcome = await executeCrawlerStep(execDeps, execOpts, {
      state: state as ManagerGraphState,
      effQuery: question,
      timeoutMs: opts.timeoutMs,
      sendThinking: (t: string) => opts.sendEvent({ event: 'thinking', data: t, from: 'crawler' }),
      allowRetry: false,
      llm: {
        openaiApiKey: opts.openaiApiKey,
        openaiModel: opts.openaiModel,
        openaiBaseUrl: opts.openaiBaseUrl
      },
      llmInvoke
    })
    await appendMetrics({ runId: opts.runId, phase: 'crawler', ms: Date.now() - t0 })
    const task = outcome.task || question
    const answer = outcome.output
    const result = outcome.rawResult
    const patch = result != null ? crawlerTaskPlanPatch(result, task) : null
    const crawlerEvidence = outcome.ok && outcome.evidence
      ? outcome.evidence
      : { kind: 'crawler' as const, query: question }
    emitTrace({
      type: 'step_end',
      agent: 'crawler',
      ms: Date.now() - t0,
      status: outcome.ok ? 'ok' : 'error',
      evidence: crawlerEvidence,
      outputSummary: summarize(answer),
      error: outcome.ok ? undefined : outcome.error,
      at: new Date().toISOString()
    })
    if (!outcome.ok) {
      notifyAgentFailure('crawler', String(outcome.error || 'crawler step failed'))
      return { results: { crawler: answer }, evidence: [crawlerEvidence] }
    }
    if (isCrawlerResultEmpty(result, answer)) {
      opts.sendEvent({ event: 'thinking', data: '爬虫未抓取到有效信息，将基于现有资料完成任务。', from: 'manager' })
      return { results: { crawler: '未从公开网页中获取到相关数据。' }, evidence: [crawlerEvidence] }
    }
    if (outcome.clarifyQuestions?.length) {
      return {
        results: { crawler: answer },
        evidence: [crawlerEvidence],
        meta: mergeMeta(state, {
          needsClarify: true,
          clarifyQuestions: outcome.clarifyQuestions,
          uncertainty: 'high'
        }),
        taskPlan: mergeTaskPlan(
          state.taskPlan ?? null,
          { ...(patch ?? {}), needsClarification: true, clarificationQuestions: outcome.clarifyQuestions },
          state.intent,
          getEffectivePlanSteps(state as any)
        )
      }
    }
    return {
      results: { crawler: answer },
      evidence: [crawlerEvidence],
      taskPlan: patch ? mergeTaskPlan(state.taskPlan ?? null, patch, state.intent, getEffectivePlanSteps(state as any)) : (state.taskPlan ?? null)
    }
  }

}
