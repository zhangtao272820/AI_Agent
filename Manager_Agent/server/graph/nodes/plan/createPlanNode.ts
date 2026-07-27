import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { buildAgentScopedQuery, clausesFromMeta, isClauseDecomposeEnabled, agentsFromClauses } from '../../core/routing/clauses'
import { stepDispatchDraftFromMeta } from '../../core/proPuStack'
import { composeManagerPromptContext } from '../../core/plan/contextComposer'
import { sanitizePlanSteps } from '../../core/stepIsolation'
import {
  applyRoutePlanCoverage,
  finalizePlanForExecution,
  normalizePlanSteps,
  reconcilePlanWithRoute
} from '../../core/plan'
import { validateAndPreparePlan } from '../../core/plan/planValidate'
import {
  mergePlanWithClauseMaterialization
} from '../../core/routing/clausePlanBinding'
import { resolvePipelineHints, pipelineHintsFromMeta } from '../../llm/pipelineHintsLlm'
import { applyMediaPlanTopology, resolveMediaPlanTopology } from '../../llm/mediaPlanLlm'
import {
  effectiveUserTask,
  preferCurrentTurnScope,
  routingHeuristicsUserText
} from '../../core/text'
import { unhealthyAgentsForPrompt } from '../../core/agent/agentRegistry'
import type { Step } from '../../../utils/shared/taskPlan'
import { parsePlanLlmJson, PLAN_JSON_EXAMPLE } from '../../core/shared/llmJson'
import { PLANNER_INTRO, getPlannerPlaybookRules, getAgentScopedPlaybookAddons } from '../../core/evolution/playbookPrompts'
import { isAdminBlockedForState } from '../../core/db/writeGate'
import { resolveTaskConstraints, taskConstraintsFromMeta } from '../../llm/taskConstraintsLlm'
import { intentClassifyFromMeta } from '../../llm/intentClassifyLlm'
import {
  blueprintCoversRequiredAgents,
  formatPlanBlueprintForPrompt,
  isPlanBlueprintMaterializeEnabled,
  materializeStepsFromBlueprint,
  planBlueprintFromMeta,
  resolvePlanBlueprintByLlm
} from '../../llm/planBlueprintLlm'
import { shouldMaterializePlanFromBlueprint } from '../../core/routing/proRoutePolicy'
import { repairMissingPlanStepsByLlm } from '../../llm/planRepairLlm'
import { formatWebExecutionModeForPrompt, webExecutionModeFromMeta } from '../../llm/webTaskStructuralLlm'
import {
  formatPlanOrchestrationSummary,
  isOrchVerbose,
  notePlanInternalFix
} from '../../orchestrate/orchestrationNarrative'
import { emitPlanDagEvent } from '../../core/routing/routeStepsEvent'
import { emitPlanStepsEvent } from '../../core/plan/planStepsEvent'
import { coerceConstraintsForSimpleDbQuery, coerceConstraintsForSimpleRagQuery } from '../../../utils/db/managerDbSchemaHintsPolicy'
import { ensureDbProbeHintsForPlan } from '../../../utils/db/managerDbHintsLlm'
import { probeAdminAgentReadiness, isAdminReadinessProbeEnabled } from '../../../utils/admin/managerAdminReadinessProbe'
import { buildAgentRegistry } from '../../core/agent/agentRegistry'
import { agentWsUrlToHttpOrigin } from '../../../utils/platform/agentEndpoints'
import { enrichTaskPlanWithDbPlan } from '../../core/db/dbPrefetch'
import { resolveDbPrefetchQuestionFromState, resolveDbStepQuestionSync } from '../../core/db/dbStepQuestion'
import { buildDbChartShortcutPlan, buildAdminOnlyShortcutPlan, buildDbOnlyShortcutPlan, buildRagOnlyShortcutPlan, shouldUseAdminOnlyShortcut, shouldUseDbChartShortcut, shouldUseDbOnlyShortcut, shouldUseRagOnlyShortcut } from '../../core/plan/planShortcuts'
import { shouldSkipLegacyPlanShortcuts, shouldSkipPlanRuleFallback } from '../../orchestrate/unifiedRouting'
import type { TaskConstraints } from '../../core/plan'
import { PLANNER_RULES_FALLBACK, stripAdminStepsIfBlocked } from './helpers'
import type { CreatePlanNodeDeps } from './types'
import { createPlanQueryHelpers } from './planQueryHelpers'
import { createPlanNodeRun } from './planNodeRun'
import type { CreatePlanNodeDeps } from './types'

export function createPlanNode(deps: CreatePlanNodeDeps) {
  return createPlanNodeRun(deps, createPlanQueryHelpers(deps))
}
