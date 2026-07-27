/**
 * 专业模式路由 SSOT
 *
 * LLM-First（convergence 默认）：编排 LLM 一次产出 cap/clauses/planBlueprint → Planner 蓝图材料化。
 * 快路径（MANAGER_PRO_MODE=fast）：PU-Stack 冻结 cap，跳过编排 LLM。
 */
import { resolveManagerEnvBool } from '../../../utils/platform/managerEnvModes'
import { isPlanBlueprintMaterializeEnabled } from '../../llm/planBlueprintLlm'
import type { PlanBlueprint } from '../../llm/planBlueprintLlm'
import type { ProbeDbSlice } from '../probe/probeInterpretation'
import { isLlmFirstRouteEnabled } from '../../orchestrate/unifiedRouting'
import {
  capFloorFromPuStackMeta,
  isPuStackOrchestratorAuthority
} from '../../orchestrate/puStackOrchestratorAuthority'
import { stepDispatchDraftFromMeta } from '../proPuStack'
import type { OrchestratorCapPolicy } from '../../orchestrate/orchestratorCapPolicy'

/** 由 MANAGER_PRO_MODE / MANAGER_PRO_STRONG_ROUTE 解析（见 managerEnvModes PRO_PRESETS） */
export function isProStrongRouteEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveManagerEnvBool('MANAGER_PRO_STRONG_ROUTE', env)
}

/** PU-Stack 复合读题结果是否可用于编排 hint（非「跳过 LLM」开关） */
export function hasPuStackCompositeHint(meta: unknown): boolean {
  return isPuStackOrchestratorAuthority(meta)
}

/** 是否走 pu_stack_authority 快路径（跳过编排 LLM） */
export function shouldPuStackBypassOrchestratorLlm(meta: unknown, env: NodeJS.ProcessEnv = process.env): boolean {
  if (isLlmFirstRouteEnabled(env)) return false
  if (isProStrongRouteEnabled(env)) return false
  return hasPuStackCompositeHint(meta)
}

/** 编排 cap 策略：强路由 default；快路径 frozen */
export function resolveProOrchestratorCapPolicy(
  meta: unknown,
  env: NodeJS.ProcessEnv = process.env
): OrchestratorCapPolicy {
  if (shouldPuStackBypassOrchestratorLlm(meta, env)) return { mode: 'frozen' }
  return { mode: 'default' }
}

/** 是否应用 PU-Stack 冻结 cap 不变量 */
export function shouldApplyFrozenPuCap(
  meta: unknown,
  capPolicy?: OrchestratorCapPolicy,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (!hasPuStackCompositeHint(meta)) return false
  if (isProStrongRouteEnabled(env)) return false
  return (capPolicy?.mode ?? 'frozen') === 'frozen'
}

/** 编排 LLM + Judge 已产出可用蓝图（强路由 Planner 材料化前提） */
export function isOrchestratorBlueprintReady(meta: unknown, minConfidence = 0.6, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!meta || typeof meta !== 'object') return false
  const m = meta as Record<string, unknown>
  if (!isLlmFirstRouteEnabled(env) && m.orchestratorJudgeAccept === false) return false
  if (!m.unifiedOrchestrator) return false
  const bp = m.planBlueprint as PlanBlueprint | undefined
  if (!bp?.steps?.length) return false
  return Number(bp.confidence ?? 0) >= minConfidence
}

/** Planner 是否跳过 LLM、直接蓝图材料化 */
export function shouldMaterializePlanFromBlueprint(
  state: { intent?: string; meta?: unknown },
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (!isPlanBlueprintMaterializeEnabled()) return false
  if (state.intent !== 'multi') return false
  if (isLlmFirstRouteEnabled(env)) {
    return isOrchestratorBlueprintReady(state.meta, 0.55)
  }
  if (isProStrongRouteEnabled(env)) {
    return isOrchestratorBlueprintReady(state.meta)
  }
  return true
}

export function puStackCapFloor(
  meta: unknown,
  probe?: { db?: ProbeDbSlice; rag?: { hits?: number } } | null
) {
  return capFloorFromPuStackMeta(meta, probe)
}

/** 注入编排 LLM：读题 draft 对齐约束（非 cap 权威，仅帮助模型填对 JSON 字段） */
export function formatPuStackDraftBindingForOrchestrator(meta: unknown): string {
  if (isLlmFirstRouteEnabled()) return ''
  const draft = stepDispatchDraftFromMeta(meta)
  if (draft.length < 2) return ''
  const agents = [...new Set(draft.map((d) => String(d.agent || '').trim()).filter(Boolean))]
  const wantsViz = (meta as Record<string, unknown>)?.wantsVisualizeHint === true
  const pipeline = agents.some((a) => ['rag', 'db', 'crawler'].includes(a)) && (wantsViz || draft.length >= 2)
  const capHint = pipeline
    ? [...new Set([...agents, 'clean', 'code', ...(wantsViz ? ['visualize'] : [])])].join('+')
    : agents.join('+')
  return [
    '【读题 draft → 编排 JSON 对齐（须由你输出完整 JSON，勿省略字段）】',
    `- allowedAgents / suggestedAgents 须含：${capHint}`,
    `- clauses 共 ${draft.length} 条，与下列子句一一对应`,
    `- 含 db 子句 → isDbAnchored=true, dataSources 含 db`,
    `- 含 admin 子句 → needsAdmin=true, suggestedAgents 含 admin`,
    `- planBlueprint.steps 每 agent 一步，queryFocus 由 scopedUserLanguage 改写为职责句（≥8字）`,
    ...draft.map((d, i) => `  c${i + 1} ${d.agent}: ${String(d.scopedUserLanguage || '').slice(0, 100)}`)
  ].join('\n')
}

/** 注入编排 LLM 的 PU-Stack hint（弱参考，须与用户末轮一致） */
export function formatPuStackOrchestratorHint(meta: unknown): string {
  if (!meta || typeof meta !== 'object') return ''
  const m = meta as Record<string, unknown>
  const parts: string[] = ['【PU-Stack 读题 hint（须与末轮一致；不一致以末轮为准）】']
  if (m.taskShape) parts.push(`taskShape=${String(m.taskShape)}`)
  if (m.dataPlaneTaskIntent) parts.push(`taskIntent=${String(m.dataPlaneTaskIntent)}`)
  if (m.dataPlanePrimaryPlane) parts.push(`primaryPlane=${String(m.dataPlanePrimaryPlane)}`)
  if (m.requiresAgentPipelineHint === true) parts.push('requiresAgentPipeline=true')
  if (m.wantsVisualizeHint === true) parts.push('wantsVisualize=true')
  if (m.wantsReportHint === true) parts.push('wantsReport=true')
  if (m.wantsAdminHint === true) parts.push('wantsAdmin=true')
  const draft = stepDispatchDraftFromMeta(m)
  if (draft.length) {
    parts.push(
      `stepDispatchDraft: ${draft.map((d) => `${d.agent}→${String(d.scopedUserLanguage || '').slice(0, 80)}`).join(' | ')}`
    )
  }
  const floor = capFloorFromPuStackMeta(m, null)
  if (floor.length) parts.push(`capFloor=${floor.join('+')}`)
  return parts.length <= 1 ? '' : parts.join('\n')
}

/** 编排流水线 source 后缀（便于 UI 区分强路由 vs 快路径） */
export function orchestratorSourceLabel(base: string, meta: unknown, env: NodeJS.ProcessEnv = process.env): string {
  if (shouldPuStackBypassOrchestratorLlm(meta, env)) return base
  if (hasPuStackCompositeHint(meta) && isProStrongRouteEnabled(env)) {
    return base === 'pu_stack_authority' ? 'pu_stack_hint_strong' : `${base}_strong`
  }
  return base
}
