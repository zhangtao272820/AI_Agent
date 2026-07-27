import type { ChatOpenAI } from '@langchain/openai'
import {
  createManagerChatOpenAI,
  callAiAdminAgent,
  callCodeAgent,
  callCrawlerAgent,
  callLobsterAgent,
  callDbAgent,
  callMultimodalAgent,
  callMusicAgent,
  callVideoAgent,
  callRagAgent,
  fetchDbTaskPlan,
  ragProbeTimeoutMs,
  buildAgentTraceHeaders,
  EntitiesSchema,
  ForceIntentSchema,
  IntentSchema,
  PlanSchema,
  RouteSchema,
  StepSchema,
  normalizeEntities,
  type ForceIntent,
  type Intent,
  type Step,
  type TaskPlan,
  createRagRelevanceJudge,
  createRagEvidenceMatchJudge,
  createRagScopeHintJudge
} from '../wireGraphUtilsDeps'
import { Annotation } from '@langchain/langgraph'
import { BaseMessage } from '@langchain/core/messages'
import { z } from 'zod'
import {  clampNumber,
  defaultPolicy,
  extractStructuredPayload,
  extractTotalTokens,
  loadManagerPolicy,
  loadManagerPolicyShadow,
  maybeUpdateManagerPolicy,
  readHistoryEntries,
  safeJsonParse,
  sanitizeUntrustedText,
  summarizeManagerPolicyDiff
} from '../../core/shared'
import { buildStepContext, buildTaskPlan, enforcePlanConstraints, enforcePlanCoverage, getEffectivePlanSteps, mergeTaskPlan, normalizePlanSteps, type TaskConstraints } from '../../core/plan'
import { appendConstraintsToQuery, crawlerTaskPlanPatch, deriveScenarioKey, estimateTokensFromMessages, estimateTokensFromText, filterCrawlerResultDomestic, hasStrongDbAnchor, isCapabilityOutOfScope, isExplicitMultiRequest, lastUserText, needsDataFoundation, normalizeFinalUserText, parseCrawlerClarifyPayload, parseRagClarifyPayload, percentile, shouldPreferMulti, stripLatexMath, uncertaintyFromConfidence } from '../../core/text'
import { createPlanPreviewNode } from '../../nodes/planPreview'
import { compileManagerGraph } from '../graph'
import { getManagerLangGraphCheckpointer } from '../../core/runtime/langgraphCheckpointer'
import { createFixNode } from '../../nodes/fix'
import { createExecutionNodes } from '../../nodes/exec'
import { createMultiNode } from '../../nodes/multi'
import { createFinalNodes } from '../../nodes/final'
import { appendMemory, appendMetrics, appendNluMetrics, appendPolicyShadowObserve, isDbNoData, readFeedbackForRun } from '../../core/runtime/runtimePersistence'
import { buildClarifyQuestionsFromContext } from '../../core/plan/clarifyContext'
import { createPlanLinterNode } from '../../nodes/planLinter'
import { createResourceNode } from '../../nodes/resource'
import { createToolHealthNode } from '../../nodes/toolHealth'
import { createTurnScopeNode } from '../../nodes/turnScope'
import { createProbeNode } from '../../nodes/probe'
import { createClarifyNode, createMetacogNode } from '../../nodes/meta'
import { createRouterNode } from '../../nodes/router'
import { createDecomposeNode } from '../../nodes/decompose'
import { createIntentClassifyNode } from '../../nodes/intentClassify'
import { createOrchestrateNode } from '../../nodes/orchestrate'
import { createWebSearchNode } from '../../nodes/search'
import { createPrefetchNode } from '../../nodes/prefetch'
import { createPlanNode } from '../../nodes/plan'
import { analyzePlanQualityFromMemory, planQualityHintForPlanner, recordPlanOutcome } from '../../core/plan/planQuality'
import { createManagerRuntime } from '../../core/runtime/runtime'
import { createInternalCollaborators } from '../../core/runtime/internalCollaborators'
import { createSecurityNode } from '../../nodes/security'
import { createSchedulerNode } from '../../nodes/scheduler'
import { createMonitorNode } from '../../nodes/monitor'
import { createEvaluatorNode } from '../../nodes/evaluator'
import { createOptimizerNode } from '../../nodes/optimizer'
import { createExecutionModeNode } from '../../nodes/mode'
import { createVoteAggregatorNode } from '../../nodes/voteAggregator'
import { resolveEffectiveManagerPolicy } from '../../core/evolution/policyCanary'
import { shouldSuppressCanaryForSession } from '../../core/routing/routeStrategy'
import fs from 'node:fs/promises'
import path from 'node:path'
import { traceable } from 'langsmith/traceable'

import { GraphState, FixStrategySchema } from './graphAnnotation'
import {
  buildClarifyQuestions,
  readEnvNumber,
  readEnvString,
  type ExperienceIndex,
  type SendEvent
} from './graphFactoryHelpers'
import type { WireGraphNodesCtx } from './wireGraphCtx'

export function wireRouteGraphNodes(ctx: WireGraphNodesCtx) {
  const {
    opts,
    policyDir,
    ensureNotAborted,
    mergeMeta,
    mergeResources,
    llmInvoke,
    lastUserText,
    fetchJson,
    policyPromise,
    defaultPolicy,
    appendMemory,
    appendMetrics,
    safeJsonParse,
    percentile,
    summarize,
    emitTrace,
    probeRagEvidence,
    ragEvidenceFromProbe,
    runInternalAgent,
    runAlwaysInternalCollaborators,
    formatReferences,
    redactSecrets,
    timeLeftMs,
    buildClarifyQuestions,
    FixStrategySchema,
    getModel,
    traceRun
  } = ctx
    const resourceNode = createResourceNode({
      opts,
      readEnvNumber,
      mergeResources,
      mergeMeta
    })

    const toolHealthNode = createToolHealthNode({
      opts: {
        sendEvent: opts.sendEvent,
        dbAgentHttpUrl: opts.dbAgentHttpUrl,
        dbAgentWsUrl: opts.dbAgentWsUrl,
        ragAgentHttpUrl: opts.ragAgentHttpUrl,
        codeAgentWsUrl: opts.codeAgentWsUrl,
        crawlerAgentWsUrl: opts.crawlerAgentWsUrl,
        aiAdminAgentWsUrl: opts.aiAdminAgentWsUrl,
        multimodalAgentHttpUrl: opts.multimodalAgentHttpUrl,
        musicAgentHttpUrl: String(process.env.MUSIC_AGENT_HTTP_URL || '').trim() || 'http://127.0.0.1:13110',
        videoAgentHttpUrl: String(process.env.VIDEO_AGENT_HTTP_URL || '').trim() || 'http://127.0.0.1:13111'
      },
      policyDir,
      safeJsonParse,
      percentile
    })

    const metacogNode = createMetacogNode({
      opts,
      lastUserText,
      isCapabilityOutOfScope,
      mergeMeta
    })
    const securityNode = createSecurityNode({
      opts,
      lastUserText,
      mergeMeta,
      llmInvoke
    })

    const clarifyNode = createClarifyNode({
      opts,
      lastUserText,
      mergeMeta,
      appendMemory
    })

    const turnScopeNode = createTurnScopeNode({
      opts,
      lastUserText,
      llmInvoke,
      mergeMeta
    })

    const probeNode = createProbeNode({
      opts: {
        ...opts,
        crawlerAgentWsUrl: opts.crawlerAgentWsUrl,
        lobsterAgentWsUrl: opts.lobsterAgentWsUrl,
        codeAgentWsUrl: opts.codeAgentWsUrl
      },
      lastUserText,
      fetchJson
    })

    const decomposeNode = createDecomposeNode({
      opts,
      sessionId: opts.sessionId,
      runId: opts.runId,
      lastUserText,
      llmInvoke,
      safeJsonParse,
      mergeMeta
    })

    const intentClassifyNode = createIntentClassifyNode({
      policyDir,
      opts,
      sessionId: opts.sessionId,
      lastUserText,
      llmInvoke,
      mergeMeta
    })

    const webSearchNode = createWebSearchNode({
      opts: {
        ...opts,
        runId: opts.runId
      },
      lastUserText,
      mergeMeta,
      mergeResources,
      appendMetrics
    })

    const prefetchNode = createPrefetchNode({
      opts: {
        ...opts,
        runId: opts.runId,
        dbAgentHttpUrl: opts.dbAgentHttpUrl,
        ragAgentHttpUrl: opts.ragAgentHttpUrl,
        dbId: opts.dbId,
        userId: opts.userId,
        timeoutMs: opts.timeoutMs
      },
      mergeMeta,
      appendMetrics
    })

    const routerNode = createRouterNode({
      policyDir,
      sessionId: opts.sessionId,
      runId: opts.runId,
      userId: opts.userId,
      opts,
      policyPromise,
      defaultPolicy,
      lastUserText,
      isExplicitMultiRequest,
      shouldPreferMulti,
      needsDataFoundation,
      RouteSchema,
      llmInvoke,
      mergeMeta,
      safeJsonParse,
      summarize,
      appendConstraintsToQuery,
      uncertaintyFromConfidence,
      normalizeEntities
    })

    const orchestrateNode = createOrchestrateNode({
      policyDir,
      sessionId: opts.sessionId,
      opts,
      lastUserText,
      llmInvoke,
      mergeMeta
    })
  return {
    resourceNode,
    toolHealthNode,
    metacogNode,
    securityNode,
    clarifyNode,
    turnScopeNode,
    probeNode,
    decomposeNode,
    intentClassifyNode,
    webSearchNode,
    prefetchNode,
    routerNode,
    orchestrateNode
  }
}
