/** 平台下发的 Manager / 子 Agent 模型与特性配置（内存缓存，下次 run 生效）。 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { isPlatformConfigSyncEnabledByMode, resolveManagerEnvBool } from './managerEnvModes'

export type PlatformAgentConfigRow = {
  agent_name?: string
  name?: string
  category?: string
  port?: string
  endpoint?: string
  model_planner?: string
  model_executor?: string
  model_embedding?: string
  platform_configured?: boolean
  updated_by?: string
  feature_flags?: Record<string, unknown>
  resolved_env_models?: Record<string, string>
  env_model_source?: string
}

export function isPlatformModelOverrideActive(row?: PlatformAgentConfigRow | null): boolean {
  if (!row) return false
  if (row.platform_configured === true) return true
  const by = String(row.updated_by || '').trim()
  return Boolean(by) && by !== 'seed' && by !== 'system'
}

export type PlatformManagerModels = {
  model_route?: string
  model_plan?: string
  model_synth?: string
  model_critic?: string
  model_verifier?: string
  model_low_cost?: string
}

export type PlatformConfigPayload = {
  ok?: boolean
  version?: number
  config_version?: string
  signature?: string
  signed_at?: string
  capability_configured?: boolean
  capability_models?: Record<string, string>
  capability_layers?: unknown
  agents?: PlatformAgentConfigRow[]
  manager_models?: PlatformManagerModels | null
  qwen_base_url?: string
  profiles?: unknown
  secret_refs?: Record<string, unknown>
}

let cache: { at: number; payload: PlatformConfigPayload | null } | null = null

function cacheTtlMs() {
  const n = Number(process.env.MANAGER_PLATFORM_SYNC_TTL_MS ?? 60_000)
  return Number.isFinite(n) && n >= 5_000 ? Math.min(600_000, Math.floor(n)) : 60_000
}

export function isPlatformConfigSyncEnabled(env: NodeJS.ProcessEnv = process.env) {
  const url = String(env.CLAWHIVE_BACKEND_URL || '').trim()
  const token = String(env.CLAWHIVE_INTERNAL_TOKEN || env.MANAGER_OPS_TOKEN || '').trim()
  if (!url || !token) return false
  const byMode = isPlatformConfigSyncEnabledByMode(env)
  if (byMode !== null) return byMode
  return resolveManagerEnvBool('MANAGER_PLATFORM_CONFIG_SYNC', env)
}

/** 对齐 Python json.dumps(..., sort_keys=True, separators=(',', ':'), ensure_ascii=False) */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(',')}]`
  }
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`
}

/** 与平台 agent_config._canonical_config_body + sign_config_package 对齐。 */
export function verifyPlatformConfigSignature(
  payload: PlatformConfigPayload,
  token: string
): { ok: boolean; reason?: string } {
  const signature = String(payload?.signature || '').trim()
  const configVersion = String(payload?.config_version || '').trim()
  // Hard require when verifying with a token (platform sync path). Soft-pass removed.
  if (!signature || !configVersion) {
    return { ok: false, reason: 'missing signature or config_version' }
  }
  const secret = String(token || '').trim()
  if (!secret) return { ok: false, reason: 'missing token' }

  const body = {
    agents: payload.agents,
    capability_configured: payload.capability_configured,
    capability_layers: payload.capability_layers,
    capability_models: payload.capability_models,
    manager_models: payload.manager_models,
    profiles: payload.profiles,
    qwen_base_url: payload.qwen_base_url,
    secret_refs: payload.secret_refs
  }
  const bodyJson = stableStringify(body)
  const hashed = createHash('sha256').update(bodyJson, 'utf8').digest('hex').slice(0, 32)
  if (hashed !== configVersion) {
    return { ok: false, reason: 'config_version mismatch' }
  }
  const expected = createHmac('sha256', secret)
    .update(configVersion + bodyJson, 'utf8')
    .digest('hex')
  try {
    const a = Buffer.from(expected, 'utf8')
    const b = Buffer.from(signature, 'utf8')
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { ok: false, reason: 'signature mismatch' }
    }
  } catch {
    return { ok: false, reason: 'signature compare failed' }
  }
  return { ok: true }
}

export async function fetchPlatformAgentConfig(
  env: NodeJS.ProcessEnv = process.env
): Promise<PlatformConfigPayload | null> {
  const base = String(env.CLAWHIVE_BACKEND_URL || '').trim().replace(/\/+$/, '')
  const token = String(env.CLAWHIVE_INTERNAL_TOKEN || env.MANAGER_OPS_TOKEN || '').trim()
  if (!base || !token) return null

  const url = `${base}/api/internal/agent-config`
  const res = await fetch(url, {
    headers: { 'x-clawhive-internal-token': token, Accept: 'application/json' },
    signal: AbortSignal.timeout(Math.min(12_000, Number(env.MANAGER_PLATFORM_SYNC_TIMEOUT_MS ?? 8000) || 8000))
  })
  if (!res.ok) throw new Error(`platform agent-config ${res.status}`)
  const payload = (await res.json()) as PlatformConfigPayload
  const verified = verifyPlatformConfigSignature(payload, token)
  if (!verified.ok) {
    console.warn('[platformConfig] signature rejected:', verified.reason)
    throw new Error(`platform agent-config signature invalid: ${verified.reason}`)
  }
  return payload
}

export async function getPlatformAgentConfig(env: NodeJS.ProcessEnv = process.env) {
  if (!isPlatformConfigSyncEnabled()) return null
  const now = Date.now()
  if (cache && now - cache.at < cacheTtlMs()) return cache.payload
  try {
    const payload = await fetchPlatformAgentConfig(env)
    cache = { at: now, payload }
    return payload
  } catch (err) {
    console.warn('[platformConfig] sync failed, keep cache:', err instanceof Error ? err.message : err)
    return cache?.payload ?? null
  }
}

export function getPlatformConfigForAgentName(
  payload: PlatformConfigPayload | null | undefined,
  agentName: string
): PlatformAgentConfigRow | null {
  const rows = Array.isArray(payload?.agents) ? payload!.agents! : []
  const hit = rows.find((r) => String(r?.agent_name || r?.name || '').trim() === agentName)
  return hit || null
}

export type ManagerLlmConfig = {
  openaiApiKey: string
  openaiBaseUrl: string
  openaiModel: string
  modelRoute: string
  modelRouteMax: string
  modelPlan: string
  modelSynth: string
  modelCritic: string
  modelVerifier: string
  modelLowCost: string
}

/** 合并 runtimeConfig + 环境变量 + 平台 Manager 模型配置 */
export async function resolveManagerLlmConfig(runtimeConfig: {
  openaiApiKey?: string
  openaiBaseUrl?: string
  openaiModel?: string
}): Promise<ManagerLlmConfig> {
  const openaiApiKey = String(runtimeConfig.openaiApiKey || process.env.OPENAI_API_KEY || '').trim()
  let openaiBaseUrl = String(runtimeConfig.openaiBaseUrl || process.env.OPENAI_BASE_URL || '').trim()
  const baseModel = String(runtimeConfig.openaiModel || process.env.OPENAI_MODEL || '').trim()

  const platform = await getPlatformAgentConfig()
  if (platform?.qwen_base_url && !openaiBaseUrl) {
    openaiBaseUrl = String(platform.qwen_base_url).trim()
  }

  const managerRow = getPlatformConfigForAgentName(platform, 'Manager_Agent')
  const useCapability = Boolean(platform?.capability_configured && platform?.manager_models)
  const usePlatformModels = useCapability || isPlatformModelOverrideActive(managerRow)
  const mm = useCapability ? platform?.manager_models : usePlatformModels ? platform?.manager_models : null

  const openaiModel = String(
    (usePlatformModels ? mm?.model_synth || mm?.model_route : '') || baseModel
  ).trim()
  const modelRoute = String(
    process.env.MANAGER_MODEL_ROUTE ||
      (usePlatformModels ? mm?.model_route : '') ||
      openaiModel ||
      baseModel
  ).trim()
  const modelRouteMax = String(
    process.env.MANAGER_MODEL_ROUTE_MAX ||
      (usePlatformModels ? (platform?.capability_models as Record<string, string> | undefined)?.reason_max : '') ||
      modelRoute
  ).trim()
  const modelPlan = String(
    process.env.MANAGER_MODEL_PLAN || (usePlatformModels ? mm?.model_plan : '') || modelRoute
  ).trim()
  const modelSynth = String(
    process.env.MANAGER_MODEL_SYNTH || (usePlatformModels ? mm?.model_synth : '') || openaiModel
  ).trim()
  const modelCritic = String(
    process.env.MANAGER_MODEL_CRITIC || (usePlatformModels ? mm?.model_critic : '') || modelRoute
  ).trim()
  const modelVerifier = String(
    process.env.MANAGER_MODEL_VERIFIER ||
      (usePlatformModels ? mm?.model_verifier : '') ||
      modelSynth ||
      modelCritic
  ).trim()
  const modelLowCost = String(
    process.env.MANAGER_MODEL_LOW_COST ||
      process.env.MANAGER_MODEL_ROUTE ||
      (usePlatformModels ? mm?.model_low_cost : '') ||
      modelRoute
  ).trim()

  return {
    openaiApiKey,
    openaiBaseUrl,
    openaiModel: openaiModel || baseModel,
    modelRoute,
    modelRouteMax,
    modelPlan,
    modelSynth,
    modelCritic,
    modelVerifier,
    modelLowCost
  }
}

export function invalidatePlatformConfigCache() {
  cache = null
}
