import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { coalesceRoutingHeuristicsText, shouldRunNlCoalesce } from '../../core/routing/nlResolve'
import {
  preferCurrentTurnScope,
  routingConversationContext,
  routingHeuristicsUserText,
  buildMultiRouteAdvisory,
  shouldSkipRouteHistoryBias
} from '../../core/text'
import { clausesFromMeta, reconcileRouteAllowedAgents, agentsFromClauses } from '../../core/routing/clauses'
import { composeManagerPromptContext } from '../../core/plan/contextComposer'
import {
  buildRouteStrategyAdvice,
  isRouteStrategyEnabled
} from '../../core/routing/routeStrategy'
import {
  buildRouteBanditAdvice,
  isRouteBanditEnabled
} from '../../core/routing/routeBandit'
import {
  buildRoutePolicyRlAdvice,
  isRoutePolicyRlEnabled
} from '../../core/routing/routePolicyRl'
import {
  buildCausalRouteAdvice,
  isRouteCausalEnabled
} from '../../core/routing/routeCausal'
import { applyRouterTaskStackOp } from '../../core/task/taskStackIngest'
import {
  buildWorldModelSnapshot,
  formatWorldModelBlock,
  isWorldModelEnabled,
  saveWorldModelSnapshot
} from '../../core/task/worldModel'
import { filterAgentsRespectingWriteGate, writeGateRouterHint } from '../../core/db/writeGate'
import { reconcileExtendedAgentAvailability, unhealthyAgentsForPrompt } from '../../core/agent/agentRegistry'
import { formatGuiDeployHintForRouter } from '../../../utils/gui/managerGuiAgentAvailability'
import { buildCapabilitySnapshotFromProbe, formatCapabilityProbeBlock } from '../../core/agent/agentCapabilities'
import { parseRouteLlmJson, ROUTE_JSON_EXAMPLE } from '../../core/shared/llmJson'
import { resolveTaskConstraints, taskConstraintsFromMeta } from '../../llm/taskConstraintsLlm'
import { coerceConstraintsForSimpleDbQuery, coerceConstraintsForSimpleRagQuery } from '../../../utils/db/managerDbSchemaHintsPolicy'
import { intentClassifyFromMeta } from '../../llm/intentClassifyLlm'
import { intentRagRecallFromMeta } from '../../core/rag/intentRagRecall'
import { resolveCompositeMediaAgents } from '../../llm/mediaRouteLlm'
import type { TaskConstraints } from '../../core/plan'
import { coalesceSimpleDbRoute, coalesceSimpleRagRoute } from '../../core/plan/planShortcuts'
import {
  finalizeLlmAllowedAgents,
  finalizeLlmRouteIntent,
  inferAllowedAgentsFromProbe,
  normalizeLlmAllowedAgents,
  stripAdminIfNotInCurrentTurn,
  type ExecutableAgent
} from '../../core/routing/routeFinalize'
import {
  alignAllowedAgentsWithDataPlane,
  ensureMultiIntentForPipeline,
  reconcileIntentClassifyDataPlane,
  requiresAgentPipelineExecution,
  shouldBlockDbOnlyCoalesce,
  stripDbUnlessDbAnchored
} from '../../orchestrate/routeOrchestration'
import {
  alignAllowedAgentsWithUnderstanding,
  describeAllowedAgentDelta
} from '../../core/routing/routeUnderstandAlign'
import { supplementAllowedFromWebStructuralAsync, applyGuiRouteOverrides } from '../../llm/webTaskStructuralLlm'
import { isChatWebMode, isManagerChatWebEnabled } from '../../../utils/chat/managerChatWeb'
import {
  formatRouteOrchestrationSummary,
  formatRouteDecisionThinking,
  isOrchVerbose,
  noteRouteAdjustment
} from '../../orchestrate/orchestrationNarrative'
import { resolveNeedsWebSearchAsync } from '../../../utils/search/managerWebSearchLlm'
import {
  applyCompositeRouteGuard,
  resolveCompositeRouteGuardByLlm
} from '../../../utils/route/managerCompositeRouteGuardLlm'
import { getRouterPlaybookStatic, getAdminCapabilitiesAddon, getGuiAutomationAddon } from '../../core/evolution/playbookPrompts'
import { isUnifiedRoutingActive, shouldSkipLegacyRoutingNodes } from '../../orchestrate/unifiedRouting'
import {
  formatTurnScopeRouterHint,
  resolveTurnRoutingScope,
  shouldDirectChitchatSynth
} from '../../core/routing/turnScope'
import { emitRouteCapEvent } from '../../core/routing/routeStepsEvent'
import { sessionIntentAnchorFromMeta } from '../../core/memory/multiTurnIntent'
import { ROUTER_PLAYBOOK_FALLBACK, deriveAllowedAgentsFromRoute, finalizeAllowedAgents } from './helpers'
import type { CreateRouterNodeDeps } from './types'
import { createRouterNodeRun } from './routerNodeRun'
import type { CreateRouterNodeDeps } from './types'

export function createRouterNode(deps: CreateRouterNodeDeps) {
  return createRouterNodeRun(deps)
}
