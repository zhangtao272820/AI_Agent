/**
 * 编排叙事：对用户只展示一条清晰摘要，内部修正静默合并。
 * 成熟编排框架（LangGraph Plan-and-Execute、LLMCompiler、CrewAI）共性：
 * - 用户只见最终计划/DAG，中间 validator 修正默认不刷屏
 * - cap（谁能参与）与 execution DAG（谁先谁后、谁并行）分开展示
 * - debug 模式（MANAGER_ORCH_VERBOSE=1）才输出各层中间态
 */

import type { Step } from '../../utils/shared/taskPlan'

export function isOrchVerbose(): boolean {
  return String(process.env.MANAGER_ORCH_VERBOSE ?? '0').trim() === '1'
}

/** allowedAgents cap：集合语义，不用 → 避免被误读为执行顺序 */
export function formatAgentCap(agents: string[]): string {
  const uniq = [...new Set(agents.map((a) => String(a).trim()).filter(Boolean))]
  if (!uniq.length) return '（无）'
  return `${uniq.join('、')}（白名单 cap，非执行顺序）`
}

function depsResolved(step: Step, done: Set<string>, byId: Map<string, Step>): boolean {
  const deps = (Array.isArray(step.dependsOn) ? step.dependsOn : [])
    .map((d) => String(d ?? '').trim())
    .filter((d) => d && byId.has(d))
  return deps.every((d) => done.has(d))
}

/** 按 dependsOn 分层：同层用 ∥，层间用 → */
export function formatPlanExecutionDag(steps: Step[]): string {
  const plan = (Array.isArray(steps) ? steps : []).filter((s) => s?.agent && s?.id)
  if (!plan.length) return ''
  if (plan.length === 1) return String(plan[0]!.agent)

  const byId = new Map(plan.map((s) => [String(s.id).trim(), s]))
  const pending = new Set(plan.map((s) => String(s.id).trim()))
  const done = new Set<string>()
  const waves: string[] = []

  while (pending.size) {
    const waveIds: string[] = []
    for (const id of [...pending]) {
      const step = byId.get(id)!
      if (depsResolved(step, done, byId)) waveIds.push(id)
    }
    if (!waveIds.length) {
      return plan.map((s) => s.agent).join(' → ')
    }
    const agents = waveIds.map((id) => String(byId.get(id)!.agent))
    waves.push(agents.length > 1 ? agents.join(' ∥ ') : agents[0]!)
    for (const id of waveIds) {
      pending.delete(id)
      done.add(id)
    }
  }
  return waves.join(' → ')
}

export type RouteOrchestrationNotes = {
  cap: string[]
  adjustments: string[]
}

export function formatRouteOrchestrationSummary(notes: RouteOrchestrationNotes): string {
  const cap = formatAgentCap(notes.cap)
  if (!notes.adjustments.length) return `编排 · 路由 cap：${cap}`
  return `编排 · 路由 cap：${cap}｜系统补全：${notes.adjustments.join('；')}`
}

export function formatRouteDecisionThinking(input: {
  intent: string
  confidence: number
  allowedAgents: string[]
  adjustments: string[]
  needsWebSearch?: boolean
  webMode?: string
  rationale?: string
  userTask?: string
}): string {
  const cap = formatAgentCap(input.allowedAgents)
  const parts = [`编排 · intent=${input.intent}（${Number(input.confidence).toFixed(2)}）· ${cap}`]
  if (input.needsWebSearch) parts.push('需联网检索')
  if (input.webMode && input.webMode !== 'not_web') parts.push(`网页=${input.webMode}`)
  if (input.adjustments.length) {
    parts.push(`补全：${input.adjustments.join('；')}`)
  }
  return parts.join(' · ')
}

export type PlanOrchestrationNotes = {
  plan: Step[]
  pipelineNote?: string
  blueprintNote?: string
  internalFixes?: string[]
}

export function formatPlanOrchestrationSummary(notes: PlanOrchestrationNotes): string {
  const dag = formatPlanExecutionDag(notes.plan)
  const parts = [`编排 · 执行 DAG：${dag}`]
  if (notes.pipelineNote && isOrchVerbose()) {
    parts.push(`流水线启发：${notes.pipelineNote}`)
  }
  if (notes.blueprintNote && isOrchVerbose()) {
    parts.push(`蓝图草稿：${notes.blueprintNote}`)
  }
  if (notes.internalFixes?.length && isOrchVerbose()) {
    parts.push(`拓扑修正：${notes.internalFixes.join('；')}`)
  }
  return parts.join('｜')
}

export function noteRouteAdjustment(adjustments: string[], note: string): void {
  const t = String(note || '').trim()
  if (t) adjustments.push(t)
}

export function notePlanInternalFix(fixes: string[], note: string): void {
  const t = String(note || '').trim()
  if (t) fixes.push(t)
}

/** B3：局部修订 / 回 Plan 对人可见叙事（确定性） */
export function formatLocalReplanNarrative(input: {
  kind: 'replan' | 'rollback' | 'circuit_skip'
  reason?: string
  count?: number
  max?: number
  remainingSteps?: number
  agent?: string
}): string {
  const reason = String(input.reason || '').trim().slice(0, 200)
  if (input.kind === 'circuit_skip') {
    const agent = String(input.agent || '专才').trim()
    return `Agent「${agent}」已熔断：跳过同能力剩余步（不耗 LLM 局部修订）`
  }
  if (input.kind === 'rollback') {
    const n = Number(input.count) || 0
    const max = Number(input.max) || 0
    const base = max > 0 ? `局部修订已达上限（${n}/${max}），回退 Plan Mode，请确认剩余计划` : '回退 Plan Mode，请确认剩余计划'
    return reason ? `${base}：${reason}` : base
  }
  const n = Number(input.count) || 0
  const max = Number(input.max) || 0
  const rem = Number(input.remainingSteps)
  const head =
    max > 0 ? `局部修订剩余计划（${n}/${max}）` : `局部修订剩余计划（第 ${n} 次）`
  const remHint = Number.isFinite(rem) && rem >= 0 ? `，后续 ${rem} 步` : ''
  return reason ? `${head}${remHint}：${reason}` : `${head}${remHint}`
}

