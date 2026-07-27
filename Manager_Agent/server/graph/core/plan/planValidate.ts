/**
 * Plan-and-Execute 验证层（LLMCompiler 对齐）：
 * Planner 产出 DAG → 拓扑硬规则（clean/code）→ 语义 dependsOn → 无环校验 → cap 过滤
 * 不做正则/关键词意图改写。
 */

import type { Step } from '../../../utils/shared/taskPlan'
import type { PipelinePlanOpts } from '../routing/clauses'
import {
  applyPipelineTopologyToPlan,
  sortPlanByPipelineOrder,
  toAgentCapSet
} from '../plan'
import { resolveEffectiveDependencies, DATA_PARALLEL_AGENTS } from './planParallel'

export type PlanValidateOpts = {
  excerpt?: string
  pipelineOpts?: PipelinePlanOpts
  allowedCap?: Step['agent'][] | null
}

function stepIds(plan: Step[]): Map<string, Step> {
  const m = new Map<string, Step>()
  for (const s of plan) {
    const id = String(s.id || '').trim()
    if (id) m.set(id, s)
  }
  return m
}

/** Kahn 拓扑排序检测 DAG 无环 */
export function assertPlanDagAcyclic(plan: Step[]): { ok: boolean; cycle?: string[] } {
  const byId = stepIds(plan)
  const inDeg = new Map<string, number>()
  for (const id of byId.keys()) inDeg.set(id, 0)
  for (const s of plan) {
    const sid = String(s.id || '').trim()
    if (!sid) continue
    for (const d of resolveEffectiveDependencies(s, plan)) {
      if (!byId.has(d)) continue
      inDeg.set(sid, (inDeg.get(sid) ?? 0) + 1)
    }
  }
  const queue = [...inDeg.entries()].filter(([, d]) => d === 0).map(([id]) => id)
  let visited = 0
  while (queue.length) {
    const id = queue.shift()!
    visited += 1
    for (const s of plan) {
      const sid = String(s.id || '').trim()
      if (!sid || sid === id) continue
      const deps = resolveEffectiveDependencies(s, plan)
      if (!deps.includes(id)) continue
      const next = (inDeg.get(sid) ?? 1) - 1
      inDeg.set(sid, next)
      if (next === 0) queue.push(sid)
    }
  }
  if (visited >= byId.size) return { ok: true }
  const stuck = [...inDeg.entries()].filter(([, d]) => d > 0).map(([id]) => id)
  return { ok: false, cycle: stuck }
}

function filterPlanByCap(plan: Step[], cap: Set<Step['agent']> | null): Step[] {
  if (!cap) return plan
  const hasCode = plan.some((s) => s.agent === 'code')
  const hasData = plan.some((s) => DATA_PARALLEL_AGENTS.has(s.agent))
  const hasVizReport = plan.some((s) => s.agent === 'visualize' || s.agent === 'report')
  return plan.filter((s) => {
    if (!s?.agent) return false
    if (cap.has(s.agent)) return true
    // clean 为 code 前置结构层，cap 未列时也保留
    if (s.agent === 'clean' && hasCode && hasData) return true
    // code 为 visualize/report 硬依赖，cap 漏写 code 时仍保留
    if (s.agent === 'code' && hasVizReport && hasData) return true
    return false
  })
}

/**
 * 规划/执行统一入口：拓扑补全 + 依赖 DAG + 无环校验 + cap。
 * 硬规则（clean/code/等待上游）由 applyPipelineTopologyToPlan + resolveEffectiveDependencies 保证。
 */
export function validateAndPreparePlan(planIn: Step[], opts: PlanValidateOpts = {}): Step[] {
  const excerpt = String(opts.excerpt || '').trim()
  let plan = applyPipelineTopologyToPlan(Array.isArray(planIn) ? planIn : [], excerpt, opts.pipelineOpts)
  plan = sortPlanByPipelineOrder(plan)
  const acyclic = assertPlanDagAcyclic(plan)
  if (!acyclic.ok) {
    plan = sortPlanByPipelineOrder(plan.filter((s) => !acyclic.cycle?.includes(String(s.id || ''))))
  }
  const cap = toAgentCapSet(opts.allowedCap ?? null)
  return filterPlanByCap(plan, cap)
}

/** 描述计划首批可并行步骤（日志） */
export function describeInitialParallelWave(plan: Step[]): string {
  const ready = plan.filter((s) => resolveEffectiveDependencies(s, plan).length === 0)
  return ready.map((s) => String(s.agent || s.id)).join(' ∥ ')
}
