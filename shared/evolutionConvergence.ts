/**
 * 自进化收敛期原则（与 Manager 路由矩阵升级方案对齐）：
 * - 进化优化「怎么答好」（SQL/检索/报告措辞），不抢路由 cap 权威
 * - Bandit/Strategy 默认关；开启时仅 routeMatrixPass 的 run 可写入 Bandit
 * - promote 前须 verifyBeforePromote（含 Manager L1 路由矩阵门禁）
 */

import { resolveAgentEvolutionMode, resolveEvolutionEnvBool } from './agentEvolutionMode'

export type EvolutionScope = 'routing' | 'execution' | 'synth'

function evolutionModeToken(env: NodeJS.ProcessEnv): string {
  return String(resolveAgentEvolutionMode(env) ?? env.MANAGER_EVOLUTION_MODE ?? '').trim().toLowerCase()
}

/** MANAGER_EVOLUTION_MODE=convergence 时默认仅进化执行阶段措辞 */
function evolutionModeExecutionOnlyDefault(env: NodeJS.ProcessEnv): boolean | null {
  const m = evolutionModeToken(env)
  if (m === 'convergence' || m === 'stable' || m === 'default') return true
  if (m === 'learning' || m === 'full') return false
  if (m === 'off' || m === '0' || m === 'false') return false
  return null
}

/** MANAGER_EVOLUTION_MODE=off 时关闭 promote 路由矩阵门禁 */
function evolutionModeRouteMatrixGateDefault(env: NodeJS.ProcessEnv): boolean | null {
  const m = evolutionModeToken(env)
  if (m === 'off' || m === '0' || m === 'false') return false
  if (m === 'convergence' || m === 'learning' || m === 'stable' || m === 'default') return true
  return null
}

/** 是否允许自进化信号影响路由 cap（默认否） */
export function isEvolutionRoutingCapEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const m = evolutionModeToken(env)
  if (m === 'learning' || m === 'full') return true
  return String(env.MANAGER_EVOLUTION_ROUTING_CAP ?? '0').trim() === '1'
}

/** 子 Agent prompt 进化是否仅作用于执行阶段（SQL/检索/生成），默认是 */
export function isAgentPromptEvolutionExecutionOnly(env: NodeJS.ProcessEnv = process.env): boolean {
  const preset = evolutionModeExecutionOnlyDefault(env)
  if (preset !== null) {
    return resolveEvolutionEnvBool('EVO_AGENT_PROMPT_EXECUTION_ONLY', preset, env)
  }
  return resolveEvolutionEnvBool('EVO_AGENT_PROMPT_EXECUTION_ONLY', true, env)
}

/** Manager run 是否可标记为离线路由矩阵可信（用于 Bandit 奖励门禁） */
export function inferManagerRouteMatrixPass(meta: Record<string, unknown> | null | undefined): boolean {
  if (String(process.env.MANAGER_ROUTE_MATRIX_PASS_AUTO ?? '1').trim() === '0') return false
  if (!meta || meta.unifiedOrchestrator !== true) return false
  const src = String(meta.orchestratorSource || meta.orchestratorMode || '')
  if (/probe_|intent_rag_fast|probe_fallback|chitchat|seed_bundle/.test(src)) return false
  if (Boolean(meta.useLegacyRoute)) return false
  const lint = meta.orchestratorLintIssues
  if (Array.isArray(lint)) {
    const critical = lint.some((i) => {
      const s = String(i)
      return (
        s.includes('未覆盖') ||
        s.includes('未含') ||
        s.includes('缺失') ||
        s.includes('重复整段') ||
        s.includes('步数过多')
      )
    })
    if (critical) return false
  }
  return true
}
