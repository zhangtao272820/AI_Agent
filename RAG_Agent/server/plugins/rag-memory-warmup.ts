import { hydrateRagSignalsCache } from '../../utils/learning_signal_store'
import { hydrateRagSessionMemoryCache } from '../../utils/session_memory_store'
import { isPostgresStorageEnabled, resolveStorageBackend } from '#agent-shared/storageBackend'

/** 启动时从 PG 预热 RAG 记忆缓存 */
export default defineNitroPlugin(() => {
  const backend = resolveStorageBackend(process.env.RAG_AGENT_STORAGE_BACKEND, 'file')
  if (!isPostgresStorageEnabled(backend)) return
  void Promise.all([hydrateRagSignalsCache(600), hydrateRagSessionMemoryCache()]).catch(() => undefined)
})
