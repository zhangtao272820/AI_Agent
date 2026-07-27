import type { TaskClause } from './clauses'
import type { PlanBlueprint } from '../../llm/planBlueprintLlm'
import type { OrchestratorDecision } from '../../orchestrate/orchestratorInvariants'
import { formatAgentCap, formatPlanExecutionDag } from '../../orchestrate/orchestrationNarrative'
import { orchestratorLintSeverity } from '../../orchestrate/orchestratorStructuralLint'
import { planAgentLabel } from '../runtime/phaseLabels'

export type RoutePlanCardClause = {
  id: string
  text: string
  agents: string[]
}

export type RoutePlanCardBlueprintStep = {
  agent: string
  agentLabel: string
  queryFocus: string
}

export type RoutePlanCardPayload = {
  runId?: string
  intent: string
  agents: string[]
  capLabel: string
  dataSources: string[]
  clauses: RoutePlanCardClause[]
  blueprintSteps: RoutePlanCardBlueprintStep[]
  blueprintDag: string
  lintIssues: string[]
  lintSeverity: 'ok' | 'warn' | 'fail'
  judgeRationale?: string
  orchestratorSource: string
  needsClarify?: boolean
}

import { resolveManagerEnvBool } from '../../../utils/platform/managerEnvModes'

export function isRoutePlanCardEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveManagerEnvBool('MANAGER_ROUTE_PLAN_CARD', env)
}

function normClauses(clauses: TaskClause[] | undefined): RoutePlanCardClause[] {
  return (Array.isArray(clauses) ? clauses : []).map((c) => ({
    id: String(c.id || ''),
    text: String(c.text || '').slice(0, 280),
    agents: [...new Set((c.agents ?? []).map((a) => String(a).trim()).filter(Boolean))]
  }))
}

function normBlueprint(blueprint: PlanBlueprint | null | undefined): RoutePlanCardBlueprintStep[] {
  return (Array.isArray(blueprint?.steps) ? blueprint!.steps! : []).map((s) => {
    const agent = String(s.agent || '')
    return {
      agent,
      agentLabel: planAgentLabel(agent),
      queryFocus: String(s.queryFocus || '').slice(0, 200)
    }
  })
}

export function buildRoutePlanCardPayload(input: {
  decision: OrchestratorDecision
  orchestratorSource: string
  lintIssues?: string[]
  judgeRationale?: string
  judgeAccept?: boolean
  runId?: string
}): RoutePlanCardPayload {
  const agents = [...new Set((input.decision.allowedAgents || []).map((a) => String(a).trim()).filter(Boolean))]
  const lintIssues = [...new Set((input.lintIssues || []).map(String).filter(Boolean))]
  const blueprintSteps = normBlueprint(input.decision.planBlueprint)
  const dag =
    blueprintSteps.length ?
      formatPlanExecutionDag(
        blueprintSteps.map((s, i) => ({
          id: `bp_${i + 1}`,
          agent: s.agent,
          query: s.queryFocus
        }))
      )
    : ''

  return {
    runId: input.runId || undefined,
    intent: String(input.decision.intent || ''),
    agents,
    capLabel: formatAgentCap(agents),
    dataSources: [...new Set((input.decision.intentClassify?.dataSources ?? []).map(String).filter(Boolean))],
    clauses: normClauses(input.decision.clauses),
    blueprintSteps,
    blueprintDag: dag,
    lintIssues,
    lintSeverity: orchestratorLintSeverity(lintIssues),
    judgeRationale: input.judgeRationale ? String(input.judgeRationale).slice(0, 400) : undefined,
    orchestratorSource: String(input.orchestratorSource || ''),
    needsClarify: input.decision.needsClarify === true
  }
}

export function buildRoutePlanCardFromState(state: {
  meta?: Record<string, unknown>
  allowedAgents?: string[]
  intent?: string
}): RoutePlanCardPayload | null {
  const meta = state.meta
  if (!meta || meta.unifiedOrchestrator !== true) return null
  const classify = (meta.intentClassify || {}) as Record<string, unknown>
  const clauses = normClauses((meta.taskClauses as TaskClause[]) || [])
  const blueprint = meta.planBlueprint as PlanBlueprint | undefined
  const blueprintSteps = normBlueprint(blueprint)
  const lintIssues = Array.isArray(meta.orchestratorLintIssues)
    ? (meta.orchestratorLintIssues as string[]).map(String)
    : []

  const capAgents = [...new Set((state.allowedAgents || []).map(String).filter(Boolean))]
  const clauseAgents = clauses.flatMap((c) => c.agents).filter(Boolean)
  const agents = capAgents.length ? capAgents : [...new Set(clauseAgents)]

  if (!agents.length && !clauses.length) return null

  return {
    intent: String(state.intent || meta.intent || classify.intent || 'multi'),
    agents,
    capLabel: formatAgentCap(agents),
    dataSources: Array.isArray(classify.dataSources) ? (classify.dataSources as string[]).map(String) : [],
    clauses,
    blueprintSteps,
    blueprintDag:
      blueprintSteps.length ?
        formatPlanExecutionDag(blueprintSteps.map((s, i) => ({ id: `bp_${i + 1}`, agent: s.agent, query: s.queryFocus })))
      : '',
    lintIssues,
    lintSeverity: orchestratorLintSeverity(lintIssues),
    judgeRationale: meta.orchestratorJudgeRationale ? String(meta.orchestratorJudgeRationale).slice(0, 400) : undefined,
    orchestratorSource: String(meta.orchestratorSource || meta.orchestratorMode || ''),
    needsClarify: meta.needsClarify === true
  }
}

/** @deprecated 优先用 buildRoutePlanCardFromState（含 allowedAgents） */
export function buildRoutePlanCardFromMeta(meta: Record<string, unknown> | null | undefined): RoutePlanCardPayload | null {
  return buildRoutePlanCardFromState({ meta: meta ?? undefined })
}
