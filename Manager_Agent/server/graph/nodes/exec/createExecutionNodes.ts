import type { Intent } from '../../../utils/shared/taskPlan'
import { resolveExecutionQuery } from '../../core/routing/clauses'
import { buildMediaExecMessage } from '../../core/stepIsolation'
import { buildMediaWebContext } from '../../../utils/search/managerWebSearch'
import { buildVisualizeAgentContext, buildReportAgentContext } from '../../core/output/downstreamContext'
import { hasCodeInResults, buildCodeFirstBundle } from '#agent-shared/codeFirstAuthority'
import { resolveCodeAuthorityPayload } from '#agent-shared/codeAuthorityPayload'
import { tryCodeAuthorityDownstreamOutput } from '../../../utils/code/managerCodeDownstream'
import { createCodeAuthorityLlmModel } from '../../../utils/code/managerCodeAuthorityLlm'
import { tryDeterministicDownstreamOutput } from '#agent-shared/codeDownstreamOutput'
import { shouldDeferReportToSynth, deferredReportEvidence } from '#agent-shared/reportSynthDefer'
import { recordDownstreamMetric } from '../../core/output/downstreamMetrics'
import { gateReportOutput } from '#agent-shared/reportGate'
import { tryDeterministicVisualizeFromDbTabular } from '#agent-shared/dbPipelineDeterministic'
import { tryCleanPipeline } from '../../../utils/chat/managerCleanPipeline'
import { createCleanAlignLlmModel } from '../../../utils/chat/managerCleanLlm'
import { extractStructuredPayload } from '../../core/shared'
import { unwrapAgentCall } from '../../../utils/agents/agentResult'
import {
  effectiveUserTask,
  isStructuredDatabaseAnchoredQuery,
  lastUserText
} from '../../core/text'
import { pickRichestDbQuestion } from '../../../utils/db/managerDbQuestionLlm'
import { hasOrchestratedDbScope, resolveDbStepQuestionSync } from '../../core/db/dbStepQuestion'
import { buildCodeFixHintFromMeta, parseCodeClarifyFromMeta } from '../../../utils/code/managerCodeMeta'
import {
  buildAgentExecutorBundle,
  computePolicyDbTimeoutMs,
  executeAdminStep,
  executeCodeStep,
  executeCrawlerStep,
  executeGuiStep,
  executeDbStep,
  executeRagStep,
  isCrawlerResultEmpty,
  resolveRagRetrievalBundle
} from '../../core/executors'
import { buildAgentError, createAgentFailureNotifier, emitAgentError, emitAgentEvidence } from '../../core/agent/agentErrors'
import { emitSingleStepPlanEvent } from '../../core/plan/planStepsEvent'
import { emitStepResultEvent } from '../../core/output/stepResultEvent'
import { emitCollabPreview } from '../../core/plan/collabPreview'
import { sanitizeVisionAnswer } from '../../../utils/media/managerVisionSanitize'
import { buildDbHistoryFromState, resolveManagerAgentSessionId } from '../../core/runtime/sessionBridge'
import {
  isManagerRagRetrieveFirstEnabled,
  ragEvidenceUnitCount,
  ragRetrieveCallOptions,
  textIndicatesRagMiss,
  type RagRetrieveAttemptMode
} from '../../core/rag/ragRetrievePolicy'
import type { RagRelevanceJudge, RagEvidenceMatchJudge, RagScopeHintJudge } from '../../../utils/rag/managerRagRelevance'
import { adminScopedQueryFromMeta } from '../../../utils/admin/managerAdminTaskPayload'
import { stripAdminManagerGuards } from '../../../utils/route/managerSubAgentHelpers'
import type { LlmInvokeFn } from '../../llm/taskConstraintsLlm'
import type { CreateExecutionNodesDeps } from './types'
import { buildDbNode } from './dbNode'
import { buildRagNode } from './ragNode'
import { buildCodeNode } from './codeNode'
import { buildAdminNode } from './adminNode'
import { buildCrawlerNode } from './crawlerNode'
import { buildGuiNode } from './guiNode'
import { buildCleanNode } from './cleanNode'
import { buildVisualizeNode } from './visualizeNode'
import { buildReportNode } from './reportNode'
import { buildMusicNode } from './musicNode'
import { buildVideoNode } from './videoNode'
import { buildMultimodalNode } from './multimodalNode'
import { buildAdminConfirmResumeNode } from './adminConfirmResumeNode'
import { buildMcpToolNode } from './mcpToolNode'

export type { CreateExecutionNodesDeps } from './types'

export function createExecutionNodes(deps: CreateExecutionNodesDeps) {
  return {
    dbNode: buildDbNode(deps),
    ragNode: buildRagNode(deps),
    codeNode: buildCodeNode(deps),
    adminNode: buildAdminNode(deps),
    adminConfirmResumeNode: buildAdminConfirmResumeNode(deps),
    crawlerNode: buildCrawlerNode(deps),
    guiNode: buildGuiNode(deps),
    mcpToolNode: buildMcpToolNode(deps),
    cleanNode: buildCleanNode(deps),
    visualizeNode: buildVisualizeNode(deps),
    reportNode: buildReportNode(deps),
    multimodalNode: buildMultimodalNode(deps),
    musicNode: buildMusicNode(deps),
    videoNode: buildVideoNode(deps)
  }
}
