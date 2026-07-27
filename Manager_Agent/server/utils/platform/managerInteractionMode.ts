/**
 * 工作台交互模式：对话 vs 专业（Phase II 双轨隔离 SSOT）
 */
import { resolveManagerEnvBool } from './managerEnvModes'

export type ManagerInteractionMode = 'chat' | 'professional'

export function resolveManagerInteractionMode(
  meta?: unknown,
  _env: NodeJS.ProcessEnv = process.env
): ManagerInteractionMode {
  if (meta && typeof meta === 'object') {
    const m = meta as Record<string, unknown>
    const ctx =
      m.clientContext && typeof m.clientContext === 'object' && !Array.isArray(m.clientContext)
        ? (m.clientContext as Record<string, unknown>)
        : null
    const raw = String(
      m.interactionMode ?? m.workbenchMode ?? ctx?.interactionMode ?? ctx?.workbenchMode ?? ''
    )
      .trim()
      .toLowerCase()
    if (raw === 'professional' || raw === 'pro') return 'professional'
    if (raw === 'chat' || raw === 'dialog') return 'chat'
  }
  /** 模式仅由前端切换；服务端不设 env 默认，缺省为对话 */
  return 'chat'
}

export function isProfessionalMode(meta?: unknown, env?: NodeJS.ProcessEnv): boolean {
  return resolveManagerInteractionMode(meta, env) === 'professional'
}

export function isProUnderstandEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveManagerEnvBool('MANAGER_PRO_UNDERSTAND', env)
}

export function isProTaskShapeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.MANAGER_PRO_TASK_SHAPE !== undefined) return resolveManagerEnvBool('MANAGER_PRO_TASK_SHAPE', env)
  return isProUnderstandEnabled(env)
}

export function isProDataPlaneInferEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.MANAGER_PRO_DATA_PLANE_INFER !== undefined) return resolveManagerEnvBool('MANAGER_PRO_DATA_PLANE_INFER', env)
  return isProUnderstandEnabled(env)
}

export function isProActionPlaneInferEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.MANAGER_PRO_ACTION_PLANE_INFER !== undefined) return resolveManagerEnvBool('MANAGER_PRO_ACTION_PLANE_INFER', env)
  return isProUnderstandEnabled(env)
}

export function isProAmbiguityPolicyEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.MANAGER_PRO_AMBIGUITY !== undefined) return resolveManagerEnvBool('MANAGER_PRO_AMBIGUITY', env)
  return isProUnderstandEnabled(env)
}

export function isModeIsolateEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveManagerEnvBool('MANAGER_MODE_ISOLATE', env)
}

/** 专业模式：寒暄/确认不按闲聊短路，按领域任务继续编排（P1-6） */
export function isProChitchatContinuationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.MANAGER_PRO_CHITCHAT_CONTINUATION !== undefined) {
    return resolveManagerEnvBool('MANAGER_PRO_CHITCHAT_CONTINUATION', env)
  }
  return true
}

/** 专业模式默认开启 step query LLM 裁剪 */
export function defaultStepSanitizeForMode(mode: ManagerInteractionMode): boolean {
  return mode === 'professional'
}

export function clarifyThreshold(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.MANAGER_PRO_CLARIFY_THRESHOLD ?? '0.55')
  return Number.isFinite(n) ? Math.min(0.95, Math.max(0.35, n)) : 0.55
}
