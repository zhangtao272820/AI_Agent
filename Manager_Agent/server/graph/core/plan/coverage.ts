import { TaskPlanSchema, normalizeEntities, type Step, type TaskPlan, type Intent } from '../../../utils/shared/taskPlan'
import { extractStructuredPayload } from '../shared'
import {
  isActionExecAgent,
  isUpstreamClarifyNoise,
  shouldIncludeUpstreamDepForStep,
  shouldPassUpstreamMissing
} from '../stepIsolation'
import { appendConstraintsToDbAgentQuery, appendConstraintsToQuery } from '../text'
import {
  ensureCodeInPipelineAgents,
  isPipelineAutoCleanEnabled,
  isPipelineAutoCodeEnabled,
  needsCleanProcessing,
  needsCodeProcessing,
  PIPELINE_AGENT_ORDER,
  planNeedsCleanProcessingLayer,
  planNeedsCodeProcessingLayer,
  shouldRetainCleanStep,
  shouldRetainCodeStep,
  sortAgentsByPipelineOrder,
  type PipelinePlanOpts
} from '../routing/clauses'
import { enforceSemanticDependsOn, assignOutputParallelGroups } from './planParallel'
import { validateAndPreparePlan } from './planValidate'
import { intentClassifyFromMeta } from '../../llm/intentClassifyLlm'
import { userRequiresDbDataPlane } from '../../orchestrate/routeOrchestration'
import { normalizeStepClauseIds } from '../routing/clausePlanBinding'
import {
  COVERAGE_AGENT_ORDER,
  DATA_SOURCE_AGENTS,
  ALL_PLAN_AGENTS,
  coverageFallbackQuery,
  isMediaOnlyCap,
  type TaskConstraints
} from './constants'
import { toAgentCapSet, sortPlanByPipelineOrder, reconcileMisplacedStepDuties } from './topology'

export function enforcePlanCoverage(
  planIn: Step[],
  text: string,
  intent: Intent,
  allowedCap?: Step['agent'][] | null,
  excerptForCoverageFallback?: string | null,
  constraints?: TaskConstraints | null,
  pipelineHints?: PipelinePlanOpts['pipelineHints']
) {
  const planOut = [...planIn]
  const cap = toAgentCapSet(allowedCap ?? null)
  const excerptBase =
    excerptForCoverageFallback != null && String(excerptForCoverageFallback).trim()
      ? String(excerptForCoverageFallback).trim()
      : text

  if (intent !== 'multi') {
    if (intent === 'rag' && !constraints?.wantsReport && !constraints?.wantsVisualize) {
      const ragStep = planOut.find((s) => s.agent === 'rag')
      if (ragStep) return [ragStep]
      return [{ id: 'step_rag', agent: 'rag', query: coverageFallbackQuery('rag', excerptBase) }]
    }
    if (planOut.length > 1) return [planOut[0]]
    return planOut
  }

  /**
   * multi 任务：Planner 产出 + 路由 cap 中主执行 Agent 并集为必执行清单。
   * db/rag/crawler/gui 等须在 allowedAgents 中出现时各有一步；clean/code/report 仍由流水线启发补全。
   */
  const required = new Set<Step['agent']>(
    planOut.map((s) => s.agent).filter(Boolean) as Step['agent'][]
  )

  if (intent === 'multi' && cap) {
    /** 编排 allowedAgents 为权威：cap 内每个 agent 须各有一步（含 visualize/report/code） */
    for (const agent of cap) {
      required.add(agent)
    }
  }

  if (constraints?.wantsVisualize) required.add('visualize')
  if (constraints?.wantsReport) required.add('report')

  const pipeOpts: PipelinePlanOpts = { question: text, constraints, pipelineHints }
  const pseudoPlan = [...required].map((agent) => ({ id: `step_${agent}`, agent, query: text })) as Step[]
  if (needsCodeProcessing(pseudoPlan, pipeOpts)) required.add('code')
  const pseudoAfterCode = [...required].map((agent) => ({ id: `step_${agent}`, agent, query: text })) as Step[]
  if (needsCleanProcessing(pseudoAfterCode, pipeOpts)) required.add('clean')

  const capAllowsAgent = (agent: Step['agent']): boolean => {
    if (!cap) return true
    if (cap.has(agent)) return true
    // clean 为 code 前置结构层：cap 未列 clean 时，有 code+取数仍须补全
    if (agent === 'clean' && required.has('code')) {
      return [...required].some((a) => DATA_SOURCE_AGENTS.has(a))
    }
    // code 为 visualize/report 硬依赖：cap 漏写 code 时仍须补全
    if (
      agent === 'code' &&
      (required.has('visualize') || required.has('report') || constraints?.wantsVisualize || constraints?.wantsReport)
    ) {
      return [...required].some((a) => DATA_SOURCE_AGENTS.has(a))
    }
    return false
  }

  if (cap && isMediaOnlyCap(cap)) {
    for (const agent of cap) required.add(agent)
    if (required.size === 0) {
      const pick = COVERAGE_AGENT_ORDER.find((a) => cap.has(a))
      if (pick) required.add(pick)
    }
  }
  if (required.size === 0) {
    if (planOut.length > 0) {
      const kept = cap ? planOut.filter((s) => s?.agent && cap.has(s.agent)) : planOut
      return kept.length ? kept : planOut
    }
    const pickFallback = (): Step['agent'] => {
      if (cap) {
        for (const agent of COVERAGE_AGENT_ORDER) {
          if (cap.has(agent)) return agent
        }
        return [...cap][0] || 'multimodal'
      }
      return 'code'
    }
    const fa = pickFallback()
    return [{ id: `step_${fa}`, agent: fa, query: coverageFallbackQuery(fa, excerptBase) } as Step]
  }

  const planFiltered = planOut.filter((s) => s?.agent && (!cap || cap.has(s.agent)))
  const presentAgents = new Set(planFiltered.map((s) => s.agent))
  const missingRequired = [...required].filter((a) => !presentAgents.has(a))
  if (!missingRequired.length && planFiltered.length > 0) {
    return sortPlanByPipelineOrder(planFiltered)
  }

  // 缺步骤时按固定拓扑补全（不推翻 Planner 已有步骤顺序）
  const desiredOrder = COVERAGE_AGENT_ORDER
  const normalized: Step[] = [...planFiltered]
  for (const agent of desiredOrder) {
    if (!capAllowsAgent(agent)) continue
    if (!required.has(agent)) continue
    if (normalized.some((s) => s.agent === agent)) continue
    normalized.push({
      id: `step_${agent}_${normalized.length + 1}`,
      agent,
      query: coverageFallbackQuery(agent, excerptBase)
    } as Step)
  }

  return normalized.length ? sortPlanByPipelineOrder(normalized) : cap ? planOut.filter((s) => s?.agent && cap.has(s.agent)) : planOut
}

/** Planner 漏写 route allowedAgents 时补全步骤 */
export function applyRoutePlanCoverage(
  planIn: Step[],
  opts: {
    question: string
    intent: Intent
    allowedCap?: Step['agent'][] | null
    excerpt?: string | null
    constraints?: TaskConstraints | null
    pipelineHints?: PipelinePlanOpts['pipelineHints']
  }
): Step[] {
  let covered = enforcePlanCoverage(
    planIn,
    opts.question,
    opts.intent,
    opts.allowedCap,
    opts.excerpt ?? opts.question,
    opts.constraints,
    opts.pipelineHints
  )
  covered = reconcileMisplacedStepDuties(covered as Step[])
  return validateAndPreparePlan(covered as Step[], {
    excerpt: opts.excerpt ?? opts.question,
    pipelineOpts: { question: opts.question, constraints: opts.constraints, pipelineHints: opts.pipelineHints },
    allowedCap: opts.allowedCap
  })
}
