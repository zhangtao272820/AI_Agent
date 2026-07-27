/**
 * 子句 → 计划步骤结构化绑定（Cuddlytoddly / TDP 对齐）：
 * - 每步可选 clauseIds 引用 decompose 子句
 * - lint 校验子句 agent 覆盖率
 * - 漏步时 materialize 兜底（不用正则改意图）
 */

import type { Step } from '../../../utils/shared/taskPlan'
import {
  agentsFromClauses,
  buildAgentScopedQuery,
  type TaskClause
} from './clauses'
import { coverageFallbackQuery, toAgentCapSet } from '../plan'

const DATA_PIPELINE_AGENTS = new Set<Step['agent']>(['rag', 'db', 'crawler', 'clean', 'code'])

export type ClausePlanBindingOpts = {
  excerpt?: string
  fallbackQuery?: string
  allowedAgents?: Step['agent'][] | null
  meta?: Record<string, unknown> | null
}

function capSet(opts: ClausePlanBindingOpts): Set<Step['agent']> | null {
  return toAgentCapSet(opts.allowedAgents ?? null)
}

function capAllows(agent: Step['agent'], cap: Set<Step['agent']> | null): boolean {
  return !cap || cap.has(agent)
}

export function normalizeStepClauseIds(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out = raw.map((x) => String(x ?? '').trim()).filter(Boolean)
  return out.length ? [...new Set(out)] : undefined
}

function clauseAgentsFiltered(clause: TaskClause, cap: Set<Step['agent']> | null): Step['agent'][] {
  const agents = (clause.agents || []).filter((a) => capAllows(a, cap))
  return agents
}

function stepCoversClause(step: Step, clause: TaskClause): boolean {
  const ids = normalizeStepClauseIds((step as { clauseIds?: unknown }).clauseIds)
  if (ids?.includes(clause.id)) return true
  const agents = clause.agents || []
  if (!agents.length) return false
  return agents.includes(step.agent)
}

function clauseCovered(clause: TaskClause, plan: Step[]): boolean {
  return plan.some((s) => stepCoversClause(s, clause))
}

/** 子句 agent 覆盖率 lint（纯结构，不用正则） */
export function lintClausePlanCoverage(
  clauses: TaskClause[],
  plan: Step[],
  opts: ClausePlanBindingOpts = {}
): string[] {
  const issues: string[] = []
  if (!Array.isArray(clauses) || clauses.length <= 1) return issues
  const cap = capSet(opts)
  const steps = Array.isArray(plan) ? plan : []

  for (const clause of clauses) {
    const agents = clauseAgentsFiltered(clause, cap)
    if (!agents.length) continue
    if (clauseCovered(clause, steps)) continue
    issues.push(
      `子句遗漏：${clause.id}「${clause.text.slice(0, 48)}${clause.text.length > 48 ? '…' : ''}」须在 steps 中体现 agent=${agents.join('+')}`
    )
  }

  const required = agentsFromClauses(clauses).filter((a) => capAllows(a, cap))
  const present = new Set(steps.map((s) => s.agent))
  for (const agent of required) {
    if (!present.has(agent)) {
      issues.push(`子句 agent 遗漏：计划中缺少 ${agent} 步骤（来自子句拆解）`)
    }
  }

  return issues
}

function materializeStepForClauseAgent(
  clause: TaskClause,
  agent: Step['agent'],
  opts: ClausePlanBindingOpts,
  seq: number
): Step {
  const fb = String(opts.excerpt || opts.fallbackQuery || clause.text || '').trim()
  const scoped = buildAgentScopedQuery(agent, [clause], fb, opts.meta ?? null)
  const query = scoped.trim() || coverageFallbackQuery(agent, fb)
  return {
    id: `step_${clause.id}_${agent}_${seq}`,
    agent,
    query,
    clauseIds: [clause.id]
  }
}

/** 由子句确定性生成根步骤（每子句每 agent 一步，默认无 dependsOn） */
export function materializePlanFromClauses(
  clauses: TaskClause[],
  opts: ClausePlanBindingOpts = {}
): Step[] {
  const cap = capSet(opts)
  const out: Step[] = []
  let seq = 0
  for (const clause of clauses) {
    const agents = clauseAgentsFiltered(clause, cap)
    if (!agents.length) continue
    for (const agent of agents) {
      seq += 1
      out.push(materializeStepForClauseAgent(clause, agent, opts, seq))
    }
  }
  return out
}

/** Planner 未写 clauseIds 时，按 agent 唯一匹配子句回填 */
export function attachClauseIdsToPlan(planIn: Step[], clauses: TaskClause[]): Step[] {
  if (!clauses.length) return planIn
  return planIn.map((step) => {
    const existing = normalizeStepClauseIds((step as { clauseIds?: unknown }).clauseIds)
    if (existing?.length) return { ...step, clauseIds: existing }
    const matches = clauses.filter((c) => c.agents.includes(step.agent))
    if (matches.length === 1) {
      return { ...step, clauseIds: [matches[0]!.id] }
    }
    return step
  })
}

/**
 * admin 子句为独立办公诉求时，不得 dependsOn 取数/clean/code（除非同一步绑定多子句含取数语义）。
 */
export function enforceAdminClauseIndependence(planIn: Step[], clauses: TaskClause[]): Step[] {
  if (!planIn.length || !clauses.length) return planIn
  const byClauseId = new Map(clauses.map((c) => [c.id, c]))
  const stepById = new Map(planIn.map((s) => [String(s.id || '').trim(), s]).filter(([k]) => k))

  return planIn.map((step) => {
    if (step.agent !== 'admin') return step
    const ids = normalizeStepClauseIds((step as { clauseIds?: unknown }).clauseIds) || []
    if (!ids.length) return step
    const linked = ids.map((id) => byClauseId.get(id)).filter(Boolean) as TaskClause[]
    if (!linked.length) return step
    const standaloneAdmin = linked.every(
      (c) => c.agents.length === 1 && c.agents[0] === 'admin'
    )
    if (!standaloneAdmin) return step
    const deps = (Array.isArray(step.dependsOn) ? step.dependsOn : []).map(String).filter(Boolean)
    if (!deps.length) return step
    const cleaned = deps.filter((depId) => {
      const dep = stepById.get(depId)
      return dep && !DATA_PIPELINE_AGENTS.has(dep.agent)
    })
    if (cleaned.length === deps.length) return step
    return { ...step, dependsOn: cleaned.length ? cleaned : undefined }
  })
}

export type ClausePlanRepairResult = {
  plan: Step[]
  repaired: boolean
  reasons: string[]
  issuesBefore: string[]
  issuesAfter: string[]
}

/** 合并 Planner 步骤 + 补全遗漏子句；返回修复后计划 */
export function repairPlanClauseBinding(
  planIn: Step[],
  clauses: TaskClause[],
  opts: ClausePlanBindingOpts = {}
): ClausePlanRepairResult {
  const cap = capSet(opts)
  let plan = attachClauseIdsToPlan([...(Array.isArray(planIn) ? planIn : [])], clauses)
  const issuesBefore = lintClausePlanCoverage(clauses, plan, opts)
  const reasons: string[] = []

  if (clauses.length <= 1) {
    plan = enforceAdminClauseIndependence(plan, clauses)
    return { plan, repaired: false, reasons, issuesBefore, issuesAfter: [] }
  }

  for (const clause of clauses) {
    const agents = clauseAgentsFiltered(clause, cap)
    if (!agents.length) continue
    if (clauseCovered(clause, plan)) continue
    for (const agent of agents) {
      if (plan.some((s) => s.agent === agent && stepCoversClause(s, clause))) continue
      if (agent === 'admin' && plan.some((s) => s.agent === 'admin')) {
        const adminStep = plan.find((s) => s.agent === 'admin')!
        const ids = new Set([
          ...(normalizeStepClauseIds((adminStep as { clauseIds?: unknown }).clauseIds) || []),
          clause.id
        ])
        plan = plan.map((s) =>
          s === adminStep ? { ...s, clauseIds: [...ids] } : s
        )
        reasons.push(`合并 admin 子句 ${clause.id}`)
        continue
      }
      plan.push(materializeStepForClauseAgent(clause, agent, opts, plan.length + 1))
      reasons.push(`补步子句 ${clause.id}→${agent}`)
    }
  }

  plan = enforceAdminClauseIndependence(plan, clauses)
  const issuesAfter = lintClausePlanCoverage(clauses, plan, opts)
  return {
    plan,
    repaired: reasons.length > 0,
    reasons,
    issuesBefore,
    issuesAfter
  }
}

/** 子句拆解存在且 Planner 产出过稀：以子句 materialize 为骨，Planner 步骤补充同 agent 步 */
export function mergePlanWithClauseMaterialization(
  planIn: Step[],
  clauses: TaskClause[],
  opts: ClausePlanBindingOpts = {}
): ClausePlanRepairResult {
  if (!clauses.length) {
    return {
      plan: planIn,
      repaired: false,
      reasons: [],
      issuesBefore: [],
      issuesAfter: []
    }
  }
  if (clauses.length === 1 && (!planIn.length || planIn.length === 0)) {
    const mat = materializePlanFromClauses(clauses, opts)
    return {
      plan: mat.length ? mat : planIn,
      repaired: mat.length > 0,
      reasons: mat.length ? ['单子句 materialize'] : [],
      issuesBefore: [],
      issuesAfter: []
    }
  }
  return repairPlanClauseBinding(planIn, clauses, opts)
}
