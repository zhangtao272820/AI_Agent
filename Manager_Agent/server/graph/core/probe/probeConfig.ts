/** 统一 probe 超时：冷启动 DB/RAG 探针默认 12s，可通过 env 覆盖 */

import { isManagerDockerRuntime } from '../../../utils/platform/managerEnvModes'

export function ragProbeTimeoutMs(): number {
  const n = Number(process.env.MANAGER_RAG_PROBE_TIMEOUT_MS ?? '12000')
  return Number.isFinite(n) && n >= 2000 ? Math.min(30_000, Math.floor(n)) : 12_000
}

/** route 后并行预取 RAG /api/retrieve（Docker 冷启动默认 30s，避免 10s 硬顶超时） */
export function ragPrefetchTimeoutMs(): number {
  const explicit = Number(process.env.MANAGER_RAG_PREFETCH_TIMEOUT_MS ?? '')
  if (Number.isFinite(explicit) && explicit >= 2000) {
    return Math.min(60_000, Math.floor(explicit))
  }
  const docker = isManagerDockerRuntime()
  return docker ? 30_000 : 15_000
}

export function dbPrefetchTimeoutMs(): number {
  const explicit = Number(process.env.MANAGER_DB_PREFETCH_TIMEOUT_MS ?? '')
  if (Number.isFinite(explicit) && explicit >= 2000) {
    return Math.min(90_000, Math.floor(explicit))
  }
  const docker = isManagerDockerRuntime()
  return docker ? 45_000 : 25_000
}

export function dbProbeTimeoutMs(): number {
  const n = Number(process.env.MANAGER_DB_PROBE_TIMEOUT_MS ?? '12000')
  return Number.isFinite(n) && n >= 2000 ? Math.min(30_000, Math.floor(n)) : 12_000
}

/** crawler / code 健康探针（非 schema probe） */
export function agentHealthProbeTimeoutMs(): number {
  const n = Number(process.env.MANAGER_HEALTH_PROBE_TIMEOUT_MS ?? '4000')
  return Number.isFinite(n) && n >= 1000 ? Math.min(15_000, Math.floor(n)) : 4000
}

/** Manage-platform 端点同步超时（默认 12s，与 DB/RAG probe 对齐） */
export function platformSyncTimeoutMs(): number {
  const n = Number(process.env.MANAGER_PLATFORM_SYNC_TIMEOUT_MS ?? '12000')
  return Number.isFinite(n) && n >= 2000 ? Math.min(30_000, Math.floor(n)) : 12_000
}
