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

export function wireExecGraphNodes(ctx: WireGraphNodesCtx) {
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
    const getPlanQualityHint = async () => {
      const sig = await analyzePlanQualityFromMemory(policyDir).catch(() => ({
        llmPlanSuccessRate: 0.7,
        ruleFallbackRate: 0.3,
        avgSteps: 2,
        samples: 0
      }))
      return planQualityHintForPlanner(sig)
    }

    const planNode = createPlanNode({
      ensureNotAborted,
      opts,
      policyDir,
      sessionId: opts.sessionId,
      userId: opts.userId,
      runId: opts.runId,
      lastUserText,
      enforcePlanConstraints,
      buildTaskPlan,
      appendMemory,
      needsDataFoundation,
      fetchDbTaskPlan,
      mergeTaskPlan,
      llmInvoke,
      PlanSchema,
      safeJsonParse,
      enforcePlanCoverage,
      getPlanQualityHint,
      recordPlanOutcome: (entry: any) => recordPlanOutcome(policyDir, entry)
    })
    const schedulerNode = createSchedulerNode({
      opts,
      getEffectivePlanSteps
    })
    const modeOverride = readEnvString('MANAGER_EXECUTION_MODE_OVERRIDE', '')
    const voteTargetsOverride = readEnvString('MANAGER_VOTE_TARGETS', '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
    const executionModeNode = createExecutionModeNode({
      opts,
      getEffectivePlanSteps,
      modeOverride,
      voteTargetsOverride
    })
    const voteAggregatorNode = createVoteAggregatorNode({
      opts,
      config: {
        targets: voteTargetsOverride,
        factWeight: readEnvNumber('MANAGER_VOTE_FACT_WEIGHT', 1),
        missingPenalty: readEnvNumber('MANAGER_VOTE_MISSING_PENALTY', 1),
        lengthPenalty: readEnvNumber('MANAGER_VOTE_LENGTH_PENALTY', 0.0002),
        evidenceSupportWeight: readEnvNumber('MANAGER_VOTE_EVIDENCE_SUPPORT_WEIGHT', 1.2),
        conflictPenalty: readEnvNumber('MANAGER_VOTE_CONFLICT_PENALTY', 1.5)
      }
    })

    const planLinterNode = createPlanLinterNode({
      ensureNotAborted,
      policyDir,
      opts,
      getEffectivePlanSteps,
      lastUserText,
      buildClarifyQuestions,
      mergeMeta,
      llmInvoke
    })

    const ragJudgeModel =
      String(process.env.MANAGER_RAG_JUDGE_MODEL || opts.openaiModel || '').trim() || opts.openaiModel
    const ragJudgeDeps = { getModel, traceRun, safeJsonParse, modelName: ragJudgeModel }
    const ragRelevanceJudge = createRagRelevanceJudge(ragJudgeDeps)
    const ragEvidenceMatchJudge = createRagEvidenceMatchJudge(ragJudgeDeps)
    const ragScopeHintJudge = createRagScopeHintJudge(ragJudgeDeps)

    const { dbNode, ragNode, codeNode, adminNode, adminConfirmResumeNode, crawlerNode, guiNode, mcpToolNode, cleanNode, visualizeNode, reportNode, multimodalNode, musicNode, videoNode } = createExecutionNodes({
      ensureNotAborted,
      opts,
      policyPromise,
      defaultPolicy,
      lastUserText,
      hasStrongDbAnchor,
      callDbAgent,
      appendMetrics,
      isDbNoData,
      emitTrace,
      summarize,
      deriveScenarioKey,
      callRagAgent,
      ragEvidenceFromProbe,
      probeRagEvidence,
      parseRagClarifyPayload,
      mergeTaskPlan,
      getEffectivePlanSteps,
      mergeMeta,
      callCodeAgent,
      callAiAdminAgent,
      callCrawlerAgent,
      callLobsterAgent,
      parseCrawlerClarifyPayload,
      crawlerTaskPlanPatch,
      runInternalAgent,
      filterCrawlerResultDomestic,
      callMultimodalAgent,
      callMusicAgent,
      callVideoAgent,
      ragRelevanceJudge,
      ragEvidenceMatchJudge,
      ragScopeHintJudge,
      llmInvoke
    })

    const multiNode = createMultiNode({
      ensureNotAborted,
      opts,
      policyPromise,
      defaultPolicy,
      getEffectivePlanSteps,
      normalizePlanSteps,
      buildStepContext,
      lastUserText,
      timeLeftMs,
      callDbAgent,
      callRagAgent,
      callCrawlerAgent,
      callLobsterAgent,
      callAiAdminAgent,
      callCodeAgent,
      callMultimodalAgent,
      callMusicAgent,
      callVideoAgent,
      runInternalAgent,
      parseRagClarifyPayload,
      parseCrawlerClarifyPayload,
      probeRagEvidence,
      filterCrawlerResultDomestic,
      buildClarifyQuestions,
      appendMetrics,
      isDbNoData,
      emitTrace,
      summarize,
      mergeMeta,
      mergeTaskPlan,
      ragRelevanceJudge,
      ragEvidenceMatchJudge,
      ragScopeHintJudge,
      llmInvoke
    })
  return {
    getPlanQualityHint,
    planNode,
    schedulerNode,
    executionModeNode,
    voteAggregatorNode,
    planLinterNode,
    dbNode,
    ragNode,
    codeNode,
    adminNode,
    adminConfirmResumeNode,
    crawlerNode,
    guiNode,
    mcpToolNode,
    cleanNode,
    visualizeNode,
    reportNode,
    multimodalNode,
    musicNode,
    videoNode,
    multiNode
  }
}
