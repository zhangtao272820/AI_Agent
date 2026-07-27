/** 从 ClawHive 拉取 code_assistent_Agent 统一配置。 */

const AGENT_NAME = 'code_assistent_Agent'

type PlatformAgentConfigRow = {
  agent_name?: string
  name?: string
  model_planner?: string
  model_executor?: string
  model_embedding?: string
  platform_configured?: boolean
  updated_by?: string
}

function isPlatformModelOverrideActive(row?: PlatformAgentConfigRow | null): boolean {
  if (!row) return false
  if (row.platform_configured === true) return true
  const by = String(row.updated_by || '').trim()
  return Boolean(by) && by !== 'seed' && by !== 'system'
}

type PlatformConfigPayload = {
  ok?: boolean
  agents?: PlatformAgentConfigRow[]
}

let cache: { at: number; row: PlatformAgentConfigRow | null } | null = null

function cacheTtlMs() {
  const n = Number(process.env.CLAWHIVE_CONFIG_SYNC_TTL_MS ?? 60_000)
  return Number.isFinite(n) && n >= 5_000 ? Math.min(600_000, Math.floor(n)) : 60_000
}

function isEnabled() {
  const url = String(process.env.CLAWHIVE_BACKEND_URL || '').trim()
  const token = String(process.env.CLAWHIVE_INTERNAL_TOKEN || process.env.AGENT_INTERNAL_TOKEN || '').trim()
  return Boolean(url && token) && String(process.env.CLAWHIVE_CONFIG_SYNC ?? '1').trim() !== '0'
}

async function fetchRow(): Promise<PlatformAgentConfigRow | null> {
  if (!isEnabled()) return null
  const now = Date.now()
  if (cache && now - cache.at < cacheTtlMs()) return cache.row

  const base = String(process.env.CLAWHIVE_BACKEND_URL || '').trim().replace(/\/+$/, '')
  const token = String(process.env.CLAWHIVE_INTERNAL_TOKEN || process.env.AGENT_INTERNAL_TOKEN || '').trim()
  try {
    const res = await fetch(`${base}/api/internal/agent-config`, {
      headers: { 'x-clawhive-internal-token': token, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000)
    })
    if (!res.ok) throw new Error(String(res.status))
    const data = (await res.json()) as PlatformConfigPayload
    const row =
      (data.agents || []).find((a) => String(a?.agent_name || a?.name || '') === AGENT_NAME) || null
    cache = { at: now, row }
    return row
  } catch {
    return cache?.row ?? null
  }
}

export async function applyPlatformRuntimeOverrides<T extends Record<string, unknown>>(runtime: T): Promise<T> {
  const row = await fetchRow()
  if (!row || !isPlatformModelOverrideActive(row)) return runtime
  const executor = String(row.model_executor || '').trim()
  const planner = String(row.model_planner || '').trim()
  const embedding = String(row.model_embedding || '').trim()
  return {
    ...runtime,
    ...(executor ? { openaiModel: executor } : {}),
    ...(planner ? { openaiOrchestrationModel: planner } : {}),
    ...(embedding ? { openaiEmbeddingModel: embedding } : {})
  }
}
