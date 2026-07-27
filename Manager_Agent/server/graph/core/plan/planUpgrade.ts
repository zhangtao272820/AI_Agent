/**
 * B1 自动升档：编排 LLM 升档信号 → Plan 预览门禁。
 * 与 posture / risk / approveTier 求或；不覆盖用户显式 collaborationPosture。
 */
import type { CollaborationPosture } from '../../../utils/platform/collaborationPosture'
import { parseCollaborationPosture } from '../../../utils/platform/collaborationPosture'
import { getEffectivePlanSteps } from './build'
import type { Step } from '../../../utils/shared/taskPlan'

const WRITE_SIDE_AGENTS = new Set(['admin', 'gui'])

function hasWriteSideEffects(steps: Step[]): boolean {
  return (Array.isArray(steps) ? steps : []).some((s) => WRITE_SIDE_AGENTS.has(String(s?.agent || '').toLowerCase()))
}

export type PlanComplexity = 'low' | 'mid' | 'high'

export type PlanUpgradeSignal = {
  complexity: PlanComplexity
  needsPlanPreview: boolean
  suggestedPosture: CollaborationPosture
  upgradeReason: string
  upgradeConfidence: number
}

const COMPLEXITY_SET = new Set<PlanComplexity>(['low', 'mid', 'high'])

export function parsePlanComplexity(raw: unknown): PlanComplexity | null {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase()
  if (COMPLEXITY_SET.has(s as PlanComplexity)) return s as PlanComplexity
  return null
}

/** 从编排 raw / meta 归一化升档信号（缺省低复杂度、不强制预览） */
export function normalizePlanUpgradeSignal(raw: Record<string, unknown> | null | undefined): PlanUpgradeSignal {
  const src = raw && typeof raw === 'object' ? raw : {}
  const complexity = parsePlanComplexity(src.complexity) || 'low'
  const suggested =
    parseCollaborationPosture(src.suggestedPosture) ||
    parseCollaborationPosture(src.suggested_posture) ||
    'agent'
  let conf = Number(src.upgradeConfidence ?? src.upgrade_confidence ?? src.confidence)
  if (!Number.isFinite(conf)) conf = 0.65
  conf = Math.min(1, Math.max(0, conf))
  const needs = Boolean(src.needsPlanPreview ?? src.needs_plan_preview)
  const reason = String(src.upgradeReason ?? src.upgrade_reason ?? src.reason ?? '')
    .trim()
    .slice(0, 200)
  return {
    complexity,
    needsPlanPreview: needs,
    suggestedPosture: suggested,
    upgradeReason: reason,
    upgradeConfidence: conf
  }
}

/** 升档信号写入 meta（供 Plan 门禁与审计读取） */
export function planUpgradeMetaPatch(signal: PlanUpgradeSignal): Record<string, unknown> {
  return {
    complexity: signal.complexity,
    needsPlanPreview: signal.needsPlanPreview,
    suggestedPosture: signal.suggestedPosture,
    upgradeReason: signal.upgradeReason,
    upgradeConfidence: signal.upgradeConfidence
  }
}

/** 从编排 raw 直接产出 meta 补丁（invariants 三路共用） */
export function planUpgradeMetaFromRaw(raw: Record<string, unknown> | null | undefined): Record<string, unknown> {
  return planUpgradeMetaPatch(normalizePlanUpgradeSignal(raw))
}

function userExplicitPosture(meta?: Record<string, unknown>): CollaborationPosture | null {
  if (!meta) return null
  const fromMeta = parseCollaborationPosture(meta.collaborationPosture)
  if (fromMeta) return fromMeta
  const ctx =
    meta.clientContext && typeof meta.clientContext === 'object' && !Array.isArray(meta.clientContext)
      ? (meta.clientContext as Record<string, unknown>)
      : null
  return parseCollaborationPosture(ctx?.collaborationPosture)
}

/**
 * LLM 升档是否强制 Plan 预览（与现有门禁求或）。
 * - needsPlanPreview=true → 强制
 * - suggestedPosture=plan → 强制（自动停 Plan，不改用户显式姿态字段）
 * - upgradeConfidence < 0.5：写/高风险保守进 Plan；低风险只读不强制
 */
export function llmUpgradeRequiresPlanPreview(state: {
  intent?: string
  meta?: Record<string, unknown>
  plan?: Step[]
  taskPlan?: { steps?: Step[] }
}): boolean {
  const meta = (state.meta && typeof state.meta === 'object' ? state.meta : {}) as Record<string, unknown>
  const signal = normalizePlanUpgradeSignal(meta)
  const steps = getEffectivePlanSteps(state as any)
  if (steps.length < 1) return false

  if (signal.needsPlanPreview) return true
  if (signal.suggestedPosture === 'plan') return true

  if (signal.upgradeConfidence < 0.5) {
    const writeSide = hasWriteSideEffects(steps)
    const wm = meta.worldModel
    const wmRisk =
      wm && typeof wm === 'object' && !Array.isArray(wm)
        ? Number((wm as Record<string, unknown>).risk)
        : NaN
    const risk = Number(meta.worldModelRisk ?? (Number.isFinite(wmRisk) ? wmRisk : 0))
    const highRisk = writeSide || (Number.isFinite(risk) && risk >= 0.65) || signal.complexity === 'high'
    if (highRisk) return true
    return false
  }

  // mid/high complexity without explicit needs：仍尊重现有 tier，不单独强制
  void userExplicitPosture(meta)
  return false
}
