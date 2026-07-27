import type { Step } from '../../../utils/shared/taskPlan'
import { effectiveUserTask, lastUserText } from '../../core/text'
import { extractStructuredPayload } from '../../core/shared'
import { structuralAnswerVerdict } from '../../core/agent/agentAnswerJudge'
import { buildInternalCollabContext } from '../../core/output/downstreamContext'
import { globalFactsForInternalPayload, hasCodeInResults, buildCodeFirstBundle } from '#agent-shared/codeFirstAuthority'
import {
  getManagerMaxParallel,
  isCodeStepCompletedInRun,
  isParallelIndependentEnabled,
  listBlockingDependencies,
  suggestMaxParallelForPlan
} from '../../core/plan/planParallel'
import { validateAndPreparePlan } from '../../core/plan/planValidate'
import { runTaskFetcherLoop, describeParallelReadyBatch } from '../../core/task/taskFetcher'
import { pipelineHintsFromMeta } from '../../llm/pipelineHintsLlm'
import { taskConstraintsFromMeta } from '../../llm/taskConstraintsLlm'
import { tryCodeAuthorityDownstreamOutput, repairCodeAuthorityVisualize } from '../../../utils/code/managerCodeDownstream'
import {
  shouldDeferReportToSynth,
  deferredReportEvidence,
  shouldDeferVisualizeToSynthCollab,
  deferredVisualizeCollabEvidence
} from '#agent-shared/reportSynthDefer'
import { tryDeterministicDownstreamOutput } from '#agent-shared/codeDownstreamOutput'
import { createCodeAuthorityLlmModel } from '../../../utils/code/managerCodeAuthorityLlm'
import { shouldPassUpstreamMissing, buildAdminEffectiveQuery } from '../../core/stepIsolation'
import { isAdminReadOnlyOrchestrationStep, resolveAdminAutoConfirm } from '../../core/db/writeGate'
import type { RagRelevanceJudge, RagEvidenceMatchJudge, RagScopeHintJudge } from '../../../utils/rag/managerRagRelevance'
import {
  createAgentRunTelemetry,
  precheckAgentStep,
  recordSkippedAgentStep,
  type StepRunRecord
} from '../../core/agent/agentRunner'
import type { ManagerGraphState } from '../../state/state'
import type { AgentExecutorDeps, AgentExecutorOpts } from '../../core/executors'
import {
  applyAgentStepOutcome,
  buildMultiStepEffQuery,
  dispatchPlanAgentStep,
  hasUsableFactsFromText
} from '../../core/executors'
import { resolveMultiDbEffectiveQuery, dbAnchorCtx } from '../../../utils/db/managerDbQuestionLlm'
import { resolveDbStepQuestionSync } from '../../core/db/dbStepQuestion'
import { adminScopedQueryFromMeta } from '../../../utils/admin/managerAdminTaskPayload'
import { stripAdminManagerGuards } from '../../../utils/route/managerSubAgentHelpers'
import { resolveSubAgentScopeByLlm } from '../../../utils/route/managerSubAgentScopeLlm'
import { parseCleanPayload } from '#agent-shared/cleanPayload'
import { crawlerSourceHitsForEvent } from '../../../utils/crawler/crawlerItemsParse'
import { buildStepStatus, estimateMultiEtaMs } from '../../core/runtime/stepStatus'
import { emitPlanStepsEvent } from '../../core/plan/planStepsEvent'
import { emitStepResultEvent } from '../../core/output/stepResultEvent'
import { emitCollabPreview } from '../../core/plan/collabPreview'
import {
  buildGuiHandoffStep,
  crawlerOutcomeRouteSuggestion,
  shouldInjectGuiAfterCrawler
} from '../../core/agent/guiCrawlerHandoff'
import type { CreateMultiNodeDeps } from './types'
import { createMultiNodeRun } from './multiNodeRun'
import type { CreateMultiNodeDeps } from './types'

export function createMultiNode(deps: CreateMultiNodeDeps) {
  return createMultiNodeRun(deps)
}
