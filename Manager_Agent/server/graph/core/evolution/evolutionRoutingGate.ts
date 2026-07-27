/**
 * 自进化 → 路由 cap 总门禁（与 shared/evolutionConvergence.ts 对齐）。
 * MANAGER_EVOLUTION_MODE=convergence 时默认禁止 Bandit/Strategy/经验回放/PolicyRL 等影响或注入路由；
 * 用户末轮 + 统一编排 LLM 为唯一权威。仅 MANAGER_EVOLUTION_ROUTING_CAP=1 或 learning 模式可开。
 */

function evolutionModeToken(env: NodeJS.ProcessEnv): string {
  return String(env.MANAGER_EVOLUTION_MODE ?? '').trim().toLowerCase()
}

/** 是否允许自进化信号影响路由 cap（默认否） */
export function isEvolutionRoutingCapEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const m = evolutionModeToken(env)
  if (m === 'learning' || m === 'full' || m === 'bandit') return true
  return String(env.MANAGER_EVOLUTION_ROUTING_CAP ?? '0').trim() === '1'
}

/** 是否允许将自进化信号注入路由/编排 prompt（弱参考；不得直接改 cap） */
export function isEvolutionRoutingHintEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isEvolutionRoutingCapEnabled(env)
}
