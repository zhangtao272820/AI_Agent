/**
 * 跨 Agent 自进化 MODE SSOT：EVO_MODE 替代分散的 EVO_* / ENABLE_PROMPT_EVOLUTION 等 0/1。
 * 与 Manager 的 MANAGER_EVOLUTION_MODE 对齐；显式单项 env 仍可覆盖。
 */

export type AgentEvolutionMode = 'convergence' | 'learning' | 'off'

const OFF = new Set(['0', 'false', 'off', 'no', 'disabled'])
const ON = new Set(['1', 'true', 'on', 'yes', 'enabled'])

export function isEnvOffToken(raw: unknown): boolean {
  return OFF.has(String(raw ?? '').trim().toLowerCase())
}

export function isEnvOnToken(raw: unknown): boolean {
  return ON.has(String(raw ?? '').trim().toLowerCase())
}

function parseEvolutionModeToken(raw: string): AgentEvolutionMode | null {
  const v = String(raw ?? '').trim().toLowerCase()
  if (!v) return null
  if (v === 'off' || v === '0' || v === 'false' || v === 'no') return 'off'
  if (v === 'learning' || v === 'bandit' || v === 'full' || v === 'experiment') return 'learning'
  if (v === 'convergence' || v === 'stable' || v === 'default' || v === 'production') return 'convergence'
  return null
}

/** 集群自进化档位：EVO_MODE > MANAGER_EVOLUTION_MODE > legacy */
export function resolveAgentEvolutionMode(env: NodeJS.ProcessEnv = process.env): AgentEvolutionMode | null {
  const explicit = parseEvolutionModeToken(String(env.EVO_MODE ?? ''))
  if (explicit) return explicit
  const mgr = parseEvolutionModeToken(String(env.MANAGER_EVOLUTION_MODE ?? ''))
  if (mgr) return mgr
  return null
}

type EvolutionPreset = Record<string, boolean>

const EVO_PRESETS: Record<AgentEvolutionMode, EvolutionPreset> = {
  convergence: {
    EVO_AGENT_PROMPT_EXECUTION_ONLY: true,
    EVO_PROMOTE_REQUIRES_VERIFY: true,
    EVO_VERIFY_BEFORE_PROMOTE: true,
    EVO_ROUTE_MATRIX_GATE: true,
    ENABLE_PROMPT_EVOLUTION: true,
    RAG_ENABLE_PROMPT_EVOLUTION: true,
    CODE_ENABLE_PROMPT_EVOLUTION: true,
    EXTRACTOR_ENABLE_PROMPT_EVOLUTION: true,
    ADMIN_PROMPT_EVOLUTION: true,
  },
  learning: {
    EVO_AGENT_PROMPT_EXECUTION_ONLY: false,
    EVO_PROMOTE_REQUIRES_VERIFY: true,
    EVO_VERIFY_BEFORE_PROMOTE: true,
    EVO_ROUTE_MATRIX_GATE: true,
    ENABLE_PROMPT_EVOLUTION: true,
    RAG_ENABLE_PROMPT_EVOLUTION: true,
    CODE_ENABLE_PROMPT_EVOLUTION: true,
    EXTRACTOR_ENABLE_PROMPT_EVOLUTION: true,
    ADMIN_PROMPT_EVOLUTION: true,
  },
  off: {
    EVO_AGENT_PROMPT_EXECUTION_ONLY: true,
    EVO_PROMOTE_REQUIRES_VERIFY: true,
    EVO_VERIFY_BEFORE_PROMOTE: false,
    EVO_ROUTE_MATRIX_GATE: false,
    ENABLE_PROMPT_EVOLUTION: false,
    RAG_ENABLE_PROMPT_EVOLUTION: false,
    CODE_ENABLE_PROMPT_EVOLUTION: false,
    EXTRACTOR_ENABLE_PROMPT_EVOLUTION: false,
    ADMIN_PROMPT_EVOLUTION: false,
  },
}

/** 统一布尔：显式 env > EVO_MODE 预设 > fallback */
export function resolveEvolutionEnvBool(key: string, fallback: boolean, env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[key]
  if (raw !== undefined && String(raw).trim() !== '') {
    return !isEnvOffToken(raw)
  }
  const mode = resolveAgentEvolutionMode(env)
  if (mode && key in EVO_PRESETS[mode]) return EVO_PRESETS[mode][key]!
  return fallback
}

export function isAgentPromptEvolutionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveEvolutionEnvBool('ENABLE_PROMPT_EVOLUTION', true, env)
}

export function isRagPromptEvolutionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveEvolutionEnvBool('RAG_ENABLE_PROMPT_EVOLUTION', true, env)
}

export function isCodePromptEvolutionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveEvolutionEnvBool('CODE_ENABLE_PROMPT_EVOLUTION', true, env)
}

export function isExtractorPromptEvolutionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveEvolutionEnvBool('EXTRACTOR_ENABLE_PROMPT_EVOLUTION', true, env)
}

export function isAdminPromptEvolutionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveEvolutionEnvBool('ADMIN_PROMPT_EVOLUTION', true, env)
}
