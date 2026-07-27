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
  ROUTE_CAP_MANDATORY_AGENTS,
  COVERAGE_AGENT_ORDER,
  PIPELINE_DOWNSTREAM_AGENTS,
  DATA_SOURCE_AGENTS_LOCAL,
  DATA_SOURCE_AGENTS,
  isPostCodeCleanStep,
  ALL_PLAN_AGENTS,
  coverageFallbackQuery,
  type TaskConstraints
} from './constants'

export function repositionMisplacedCleanStep(planIn: Step[]): Step[] {
  if (!Array.isArray(planIn) || planIn.length < 2) return planIn
  const plan = [...planIn]
  const cleanIdx = plan.findIndex((s) => s.agent === 'clean')
  if (cleanIdx < 0) return plan

  const codeIdx = plan.findIndex((s) => s.agent === 'code')
  const cleanStep = plan[cleanIdx]!
  const hasData = plan.some((s) => DATA_SOURCE_AGENTS_LOCAL.has(s.agent))

  if (codeIdx >= 0 && cleanIdx > codeIdx) {
    if (hasData && !isPostCodeCleanStep(cleanStep, plan)) {
      const rest = plan.filter((_, i) => i !== cleanIdx)
      rest.splice(codeIdx, 0, cleanStep)
      return rest
    }
    return plan
  }

  let firstDownIdx = -1
  for (let i = 0; i < cleanIdx; i++) {
    if (PIPELINE_DOWNSTREAM_AGENTS.has(plan[i]!.agent)) {
      firstDownIdx = i
      break
    }
  }
  if (firstDownIdx < 0) return plan

  const rest = plan.filter((_, i) => i !== cleanIdx)
  rest.splice(firstDownIdx, 0, cleanStep)
  return rest
}

/** 稳定按流水线拓扑排序；保留同层内的 Planner 相对顺序 */
export function sortPlanByPipelineOrder(planIn: Step[]): Step[] {
  if (!Array.isArray(planIn) || planIn.length < 2) return planIn

  const plan = repositionMisplacedCleanStep(planIn)
  const originalIndex = new Map(plan.map((s, i) => [s, i]))
  const rank = new Map(COVERAGE_AGENT_ORDER.map((a, i) => [a, i]))

  const cleanStep = plan.find((s) => s.agent === 'clean')
  const codeStep = plan.find((s) => s.agent === 'code')
  const cleanAfterCode =
    Boolean(
      cleanStep &&
        codeStep &&
        plan.indexOf(cleanStep) > plan.indexOf(codeStep) &&
        isPostCodeCleanStep(cleanStep, plan)
    )

  return [...plan].sort((a, b) => {
    if (cleanAfterCode) {
      if (a.agent === 'clean' && b.agent === 'code') return 1
      if (a.agent === 'code' && b.agent === 'clean') return -1
    }
    const ra = rank.get(a.agent) ?? 999
    const rb = rank.get(b.agent) ?? 999
    if (ra !== rb) return ra - rb
    return (originalIndex.get(a) ?? 0) - (originalIndex.get(b) ?? 0)
  })
}

export function toAgentCapSet(allowedCap?: Step['agent'][] | null): Set<Step['agent']> | null {
  if (!Array.isArray(allowedCap) || !allowedCap.length) return null
  const valid = new Set<Step['agent']>(ALL_PLAN_AGENTS)
  const s = new Set<Step['agent']>()
  for (const a of allowedCap) {
    if (valid.has(a as Step['agent'])) s.add(a as Step['agent'])
  }
  return s.size ? s : null
}

/**
 * 将 LLM 计划与 route allowedAgents 对齐：仅过滤越权 agent，不补步、不改 dependsOn。
 */
export function reconcilePlanWithRoute(
  planIn: Step[],
  opts: {
    intent: Intent
    allowedAgents?: Step['agent'][] | null
    clauseAgents?: Step['agent'][] | null
    question: string
    excerpt: string
    mediaAttachment?: { filePath: string; mediaType: string; filename?: string } | null
    constraints?: TaskConstraints | null
  }
): Step[] {
  const routeAllowed = opts.allowedAgents ?? []
  const extraClauseAgents = opts.clauseAgents ?? []
  const allowedList: Step['agent'][] | null =
    routeAllowed.length || extraClauseAgents.length
      ? ([...new Set([...routeAllowed, ...extraClauseAgents])] as Step['agent'][])
      : null
  const cap = toAgentCapSet(allowedList)
  let plan = (Array.isArray(planIn) ? planIn : []).filter((s) => s?.agent && ALL_PLAN_AGENTS.includes(s.agent))
  if (cap) plan = plan.filter((s) => cap.has(s.agent))
  return plan
}

/** Planner 把 visualize/report 与 code 并列时，code 用计算职责模板（不用正则剥词） */
export function reconcileMisplacedStepDuties(plan: Step[]): Step[] {
  if (!Array.isArray(plan) || plan.length < 2) return plan
  const present = new Set(plan.map((s) => s.agent))
  return plan.map((step) => {
    if (step.agent !== 'code') return step
    if (present.has('visualize') || present.has('report')) {
      const q = String(step.query || '').trim()
      if (!q || q.length > 480) {
        return { ...step, query: coverageFallbackQuery('code', q) }
      }
    }
    return step
  })
}

/** 路由 cap 中有、计划里缺的 Agent → 补步骤（供 plan_lint / planner 后处理） */
export function materializeMissingRouteAgents(
  planIn: Step[],
  opts: {
    allowedCap: Step['agent'][]
    excerpt: string
    meta?: Record<string, unknown> | null
  }
): Step[] {
  const cap = new Set(opts.allowedCap)
  const ic = intentClassifyFromMeta(opts.meta)
  const allowDb = userRequiresDbDataPlane(ic)
  const present = new Set(planIn.map((s) => s.agent).filter(Boolean))
  const missing = [...cap].filter(
    (a) => !present.has(a) && ALL_PLAN_AGENTS.includes(a) && !(a === 'db' && !allowDb)
  )
  if (!missing.length) return planIn

  const meta = opts.meta && typeof opts.meta === 'object' ? opts.meta : {}
  const webMode = meta.webExecutionMode as { mode?: string; primaryAgent?: string } | undefined
  const guiPrimary = webMode?.mode === 'gui' || webMode?.primaryAgent === 'gui'
  const crawlOpts = {
    needsWebSearch: meta.needsWebSearch === true,
    compositeDataWeb: meta.compositeDataWebRoute === true,
    webMode: webMode?.mode
  }
  const out = [...planIn]
  const filteredMissing = guiPrimary ? missing.filter((a) => a !== 'crawler') : missing
  for (const agent of filteredMissing) {
    if (!ALL_PLAN_AGENTS.includes(agent)) continue
    out.push({
      id: `step_${agent}_route`,
      agent,
      query: coverageFallbackQuery(agent, opts.excerpt, agent === 'crawler' ? crawlOpts : undefined)
    })
  }
  return sortPlanByPipelineOrder(out)
}

/** 规划/执行共用：拓扑 dependsOn + 语义 DAG */
export function finalizePlanForExecution(planIn: Step[]): Step[] {
  const ordered = sortPlanByPipelineOrder(Array.isArray(planIn) ? planIn : [])
  const withDeps = enforceSemanticDependsOn(ensurePipelineDependsOn(ordered))
  return assignOutputParallelGroups(withDeps)
}

/** P0-3：Planner 声明的 inputs[] → dependsOn step id */
export function resolveStepInputsDependsOn(steps: Step[]): Step[] {
  if (!Array.isArray(steps) || !steps.length) return steps
  const byId = new Map<string, Step>()
  const firstIdByAgent: Partial<Record<Step['agent'], string>> = {}
  for (const s of steps) {
    const id = String(s.id || '').trim()
    if (id) byId.set(id, s)
    if (s.agent && !firstIdByAgent[s.agent]) firstIdByAgent[s.agent] = id
  }
  return steps.map((step) => {
    const rawInputs = Array.isArray((step as any).inputs) ? ((step as any).inputs as unknown[]) : []
    if (!rawInputs.length) return step
    const depIds = rawInputs
      .map((inp) => String(inp ?? '').trim())
      .filter(Boolean)
      .map((inp) => (byId.has(inp) ? inp : firstIdByAgent[inp as Step['agent']] || ''))
      .filter(Boolean)
    if (!depIds.length) return step
    const merged = new Set([
      ...(Array.isArray(step.dependsOn) ? step.dependsOn.map(String) : []),
      ...depIds
    ])
    return { ...step, dependsOn: [...merged] }
  })
}

/** P0-10：步数过多时剔除 optional / 非必需 clean·code */
export function trimBloatedPlan(
  planIn: Step[],
  opts?: PipelinePlanOpts
): { steps: Step[]; changed: boolean; reasons: string[] } {
  let out = [...(Array.isArray(planIn) ? planIn : [])]
  const reasons: string[] = []

  const withoutOptional = out.filter((s) => !(s as any).optional)
  if (withoutOptional.length < out.length) {
    reasons.push(`剔除 optional 步骤 ${out.length - withoutOptional.length} 个`)
    out = withoutOptional
  }

  if (out.length > 4 && !shouldRetainCodeStep(out, opts)) {
    const trimmed = out.filter((s) => s.agent !== 'code')
    if (trimmed.length < out.length) {
      reasons.push('步数>4 且无需计算/分析，移除 code')
      out = trimmed
    }
  }
  if (out.length > 4 && !shouldRetainCleanStep(out, opts)) {
    const trimmed = out.filter((s) => s.agent !== 'clean')
    if (trimmed.length < out.length) {
      reasons.push('步数>4 且无多源合并诉求，移除 clean')
      out = trimmed
    }
  }

  const steps = reasons.length ? out : out
  return { steps, changed: reasons.length > 0, reasons }
}

/** 保留 API；依赖拓扑由 Planner LLM 全权决定，代码不再改写 dependsOn */
export function attachPipelineDependsOn(plan: Step[]): Step[] {
  return Array.isArray(plan) ? plan : []
}

/** 取数步骤与 code/visualize/report 之间插入 clean（Planner 漏规划时的拓扑补全） */
export function ensureCleanProcessingLayer(
  planIn: Step[],
  excerpt?: string,
  opts?: PipelinePlanOpts
): Step[] {
  if (!planNeedsCleanProcessingLayer(planIn, opts)) return planIn

  const plan = [...planIn]
  const excerptBase = String(excerpt || '').replace(/\s+/g, ' ').trim()
  const dataIds = plan
    .filter((s) => DATA_SOURCE_AGENTS.has(s.agent))
    .map((s, i) => String(s.id || `step_${s.agent}_${i + 1}`))
  const cleanId = 'step_clean'
  const cleanStep: Step = {
    id: cleanId,
    agent: 'clean',
    query: coverageFallbackQuery('clean', excerptBase),
    dependsOn: dataIds.length ? dataIds : undefined
  }

  const insertAt = plan.findIndex(
    (s) => s.agent === 'code' || PIPELINE_OUTPUT_AGENTS.has(s.agent) || s.agent === 'admin'
  )
  plan.splice(insertAt >= 0 ? insertAt : plan.length, 0, cleanStep)

  for (const s of plan) {
    if (s.agent !== 'code' && !PIPELINE_OUTPUT_AGENTS.has(s.agent)) continue
    const deps = new Set(Array.isArray(s.dependsOn) ? s.dependsOn.map(String) : [])
    for (const id of dataIds) deps.delete(id)
    deps.add(cleanId)
    s.dependsOn = [...deps]
  }
  return plan
}

/** 取数/clean 步骤与 visualize/report 之间插入 code（Planner 漏规划时的拓扑补全） */
export function ensureCodeProcessingLayer(
  planIn: Step[],
  excerpt?: string,
  opts?: PipelinePlanOpts
): Step[] {
  if (!planNeedsCodeProcessingLayer(planIn, opts)) return planIn

  const plan = [...planIn]
  const excerptBase = String(excerpt || '').replace(/\s+/g, ' ').trim()
  const dataIds = plan
    .filter((s) => DATA_SOURCE_AGENTS.has(s.agent))
    .map((s, i) => String(s.id || `step_${s.agent}_${i + 1}`))
  const cleanIds = plan
    .filter((s) => s.agent === 'clean')
    .map((s, i) => String(s.id || `step_clean_${i + 1}`))
  const upstreamIds = cleanIds.length ? cleanIds : dataIds
  const codeId = 'step_code'
  const codeStep: Step = {
    id: codeId,
    agent: 'code',
    query: coverageFallbackQuery('code', excerptBase),
    dependsOn: upstreamIds.length ? upstreamIds : undefined
  }

  const insertAt = plan.findIndex((s) => PIPELINE_OUTPUT_AGENTS.has(s.agent))
  plan.splice(insertAt >= 0 ? insertAt : plan.length, 0, codeStep)

  for (const s of plan) {
    if (!PIPELINE_OUTPUT_AGENTS.has(s.agent)) continue
    const deps = new Set(Array.isArray(s.dependsOn) ? s.dependsOn.map(String) : [])
    for (const id of upstreamIds) deps.add(id)
    deps.add(codeId)
    s.dependsOn = [...deps]
  }
  return plan
}

const PIPELINE_OUTPUT_AGENTS = new Set<Step['agent']>(['visualize', 'report'])

/**
 * @param allowedCap 路由给出的可执行 Agent 白名单；有值时只保留/只补全其中的步骤，避免 enforce 把 db/admin 等硬塞进来
 * @param excerptForCoverageFallback 补全缺失步骤时 coverage 模板用的短摘录（如末轮用户话）；缺省则与 text 相同
 */
/** Planner 产出后：按模型启发 + 拓扑补全 clean/code 层，并强制输出层依赖 code */
export function applyPipelineTopologyToPlan(
  planIn: Step[],
  excerpt?: string,
  opts?: PipelinePlanOpts
): Step[] {
  let plan = [...(Array.isArray(planIn) ? planIn : [])]
  plan = ensureCodeProcessingLayer(plan, excerpt, opts)
  plan = ensureCleanProcessingLayer(plan, excerpt, opts)
  plan = finalizePlanForExecution(plan)
  return plan
}

/**
 * Planner 已含 code 时 ensureCodeProcessingLayer 会 skip，但 visualize/report 仍须 dependsOn code。
 * 否则调度器可能并行执行，visualize 在 code 完成前用 RAG 裸数出图（P0 回归）。
 */
export function ensurePipelineDependsOn(planIn: Step[]): Step[] {
  const plan = [...planIn]
  const codeStep = plan.find((s) => s.agent === 'code')
  if (!codeStep) return plan

  const codeId = String(codeStep.id || 'step_code').trim()
  const codeIdx = plan.indexOf(codeStep)
  const cleanStep = plan.find((s) => s.agent === 'clean')
  const cleanId = cleanStep ? String(cleanStep.id || 'step_clean').trim() : ''
  const cleanIdx = cleanStep ? plan.indexOf(cleanStep) : -1
  const dataIds = plan
    .filter((s) => DATA_SOURCE_AGENTS.has(s.agent))
    .map((s) => String(s.id || '').trim())
    .filter(Boolean)

  if (cleanStep) {
    const cleanDeps = new Set(Array.isArray(cleanStep.dependsOn) ? cleanStep.dependsOn.map(String) : [])
    for (const id of dataIds) cleanDeps.add(id)
    cleanStep.dependsOn = cleanDeps.size ? [...cleanDeps] : undefined
  }

  const codeDeps = new Set(Array.isArray(codeStep.dependsOn) ? codeStep.dependsOn.map(String) : [])
  // clean 在 code 之后时由 clean 等 code；此处若再让 code 等 clean 会形成环
  if (cleanId && cleanIdx >= 0 && codeIdx >= 0 && cleanIdx < codeIdx) {
    for (const id of dataIds) codeDeps.delete(id)
    codeDeps.add(cleanId)
  } else {
    for (const id of dataIds) codeDeps.add(id)
  }
  codeStep.dependsOn = codeDeps.size ? [...codeDeps] : undefined

  for (const s of plan) {
    if (!PIPELINE_OUTPUT_AGENTS.has(s.agent)) continue
    const deps = new Set(Array.isArray(s.dependsOn) ? s.dependsOn.map(String) : [])
    for (const id of dataIds) deps.delete(id)
    deps.add(codeId)
    s.dependsOn = deps.size ? [...deps] : undefined
  }
  return plan
}
