/**
 * 编排后 cap 对齐：以 LLM 产出的 dataSources / suggestedAgents / clauses 为权威。
 * 不做用户原话正则匹配；结构性剔除 probe/经验/allowedAgents 放大造成的越界 Agent。
 */

import type { IntentClassifyResult } from '../../llm/intentClassifyLlm'
import type { TaskClause } from '../routing/clauses'
import type { ExecutableAgent } from '../routing/routeFinalize'
import type { PlanBlueprint } from '../../llm/planBlueprintLlm'
import { sortAgentsByPipelineOrder, ensureCodeInPipelineAgents } from '../routing/clauses'
import {
  inferDataSourcesFromClassify,
  type DataSourceAgent
} from '../../orchestrate/routeOrchestration'

const OPTIONAL_EXEC_AGENTS = new Set<string>(['admin', 'gui', 'multimodal', 'music', 'video'])
const DATA_PLANE_AGENTS = new Set<string>(['db', 'rag', 'crawler'])

export function collectExplicitOrchestratorAgents(input: {
  classify?: IntentClassifyResult | null
  clauses?: TaskClause[]
  suggestedAgents?: string[]
}): Set<string> {
  const out = new Set<string>()
  const push = (a: unknown) => {
    const x = String(a ?? '').trim()
    if (x) out.add(x)
  }
  for (const a of input.suggestedAgents ?? input.classify?.suggestedAgents ?? []) push(a)
  for (const c of input.clauses ?? []) {
    for (const a of c.agents ?? []) push(a)
  }
  const pi = String(input.classify?.primaryIntent ?? '').trim()
  if (pi && pi !== 'multi') push(pi)
  return out
}

export function adminExplicitlyRequested(input: {
  classify?: IntentClassifyResult | null
  clauses?: TaskClause[]
  suggestedAgents?: string[]
}): boolean {
  if (input.clauses?.some((c) => (c.agents ?? []).includes('admin' as TaskClause['agents'][number]))) return true
  const suggested = input.suggestedAgents ?? input.classify?.suggestedAgents ?? []
  if (suggested.includes('admin')) return true
  return String(input.classify?.primaryIntent ?? '').trim() === 'admin'
}

function agentAuthorizedByDataPlane(agent: string, dataSources: Set<DataSourceAgent>): boolean {
  if (!DATA_PLANE_AGENTS.has(agent)) return true
  if (!dataSources.size) return true
  return dataSources.has(agent as DataSourceAgent)
}

/**
 * 对齐 cap 与 LLM 数据面（Semantic Router utterance → dataSources 字段，不用正则裁用户句）。
 */
export function applyOrchestratorCapAlignment(input: {
  allowed: ExecutableAgent[]
  classify: IntentClassifyResult
  clauses?: TaskClause[]
  suggestedAgents?: string[]
}): { allowed: ExecutableAgent[]; classify: IntentClassifyResult } {
  const explicit = collectExplicitOrchestratorAgents({
    classify: input.classify,
    clauses: input.clauses,
    suggestedAgents: input.suggestedAgents
  })

  const dsList = (
    input.classify.dataSources?.length ? input.classify.dataSources : inferDataSourcesFromClassify(input.classify)
  ) as DataSourceAgent[]
  const dsSet = new Set(dsList)
  for (const c of input.clauses ?? []) {
    for (const a of c.agents ?? []) {
      if (DATA_PLANE_AGENTS.has(String(a))) dsSet.add(a as DataSourceAgent)
    }
  }
  for (const a of explicit) {
    if (!DATA_PLANE_AGENTS.has(a)) continue
    const inClause = input.clauses?.some((c) => (c.agents ?? []).includes(a as any))
    if (inClause || dsList.includes(a as DataSourceAgent)) dsSet.add(a as DataSourceAgent)
  }

  let classify: IntentClassifyResult = {
    ...input.classify,
    suggestedAgents: [...(input.classify.suggestedAgents || [])],
    dataSources: [...dsList]
  }

  if (!explicit.has('admin')) {
    classify.needsAdmin = false
    classify.suggestedAgents = classify.suggestedAgents.filter((a) => a !== 'admin')
  }

  let allowed = input.allowed.filter((a) => {
    const x = String(a)
    if (DATA_PLANE_AGENTS.has(x)) {
      return agentAuthorizedByDataPlane(x, dsSet)
    }
    if (OPTIONAL_EXEC_AGENTS.has(x)) {
      return explicit.has(x)
    }
    return true
  })

  if (dsSet.size > 0) {
    for (const da of DATA_PLANE_AGENTS) {
      if (!dsSet.has(da as DataSourceAgent)) {
        classify.suggestedAgents = classify.suggestedAgents.filter((a) => a !== da)
      }
    }
  }

  /** admin 子句已覆盖出行/路线时，LLM 未显式要 crawler 则剔除（避免误走 web+crawler） */
  if (
    explicit.has('admin') &&
    classify.needsAdmin === true &&
    !explicit.has('crawler') &&
    !dsSet.has('crawler')
  ) {
    allowed = allowed.filter((a) => String(a) !== 'crawler')
    classify = {
      ...classify,
      needsWeb: false,
      suggestedAgents: classify.suggestedAgents.filter((a) => a !== 'crawler')
    }
  }

  allowed = ensureCodeInPipelineAgents(allowed) as ExecutableAgent[]
  allowed = sortAgentsByPipelineOrder([...new Set(allowed)]) as ExecutableAgent[]
  classify.suggestedAgents = ensureCodeInPipelineAgents(classify.suggestedAgents) as IntentClassifyResult['suggestedAgents']

  return { allowed, classify }
}

/** @deprecated 使用 applyOrchestratorCapAlignment */
export function applyUserSupremacyCap(input: {
  allowed: ExecutableAgent[]
  classify: IntentClassifyResult
  lastUser: string
  clauses?: TaskClause[]
  suggestedAgents?: string[]
}): { allowed: ExecutableAgent[]; classify: IntentClassifyResult } {
  return applyOrchestratorCapAlignment({
    allowed: input.allowed,
    classify: input.classify,
    clauses: input.clauses,
    suggestedAgents: input.suggestedAgents
  })
}

export function reconcileClassifyAgainstExplicitAgents(
  ic: IntentClassifyResult,
  explicit: Set<string>
): IntentClassifyResult {
  const out: IntentClassifyResult = {
    ...ic,
    suggestedAgents: [...(ic.suggestedAgents || [])]
  }
  if (!explicit.has('admin')) {
    out.needsAdmin = false
    out.suggestedAgents = out.suggestedAgents.filter((a) => a !== 'admin')
    if (out.primaryIntent === 'admin') out.primaryIntent = out.isMulti ? 'multi' : 'db'
  }
  return out
}

export function stripSpuriousOptionalAgents(
  allowed: ExecutableAgent[],
  explicit: Set<string>
): ExecutableAgent[] {
  const out = allowed.filter((a) => !OPTIONAL_EXEC_AGENTS.has(String(a)) || explicit.has(String(a)))
  return sortAgentsByPipelineOrder(out) as ExecutableAgent[]
}

export function filterBlueprintToExplicitAgents(
  blueprint: PlanBlueprint | null,
  cap: Set<string>
): PlanBlueprint | null {
  if (!blueprint?.steps?.length) return blueprint
  const steps = blueprint.steps.filter((s) => cap.has(String(s.agent)))
  if (!steps.length) return null
  return { ...blueprint, steps }
}
