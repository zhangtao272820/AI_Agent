import { hydrateDbSignalsCache } from '../../utils/learning_signal_store'
import { hydrateDbExperienceCache } from '../../utils/experience_store'
import { hydrateDbRouteStatsCache } from '#agent-shared/dbRouteStatsStore'
import { isPostgresStorageEnabled, resolveStorageBackend } from '#agent-shared/storageBackend'

/** 启动时从 PG 预热 DB 记忆缓存 */
export default defineNitroPlugin(() => {
  const backend = resolveStorageBackend(process.env.DB_AGENT_STORAGE_BACKEND, 'file')
  if (!isPostgresStorageEnabled(backend)) return
  void Promise.all([
    hydrateDbSignalsCache(800),
    hydrateDbExperienceCache(500),
    hydrateDbRouteStatsCache()
  ]).catch(() => undefined)
})
