import { pingAgentPg } from '#agent-shared/agentPgClient'
import { hydrateManagerMemoryCache } from '../utils/session/managerMemoryStore'
import { isPostgresStorageEnabled, resolveStorageBackend } from '#agent-shared/storageBackend'

/** postgres 模式启动时 ping PG、预热长期记忆缓存 */
export default defineNitroPlugin(() => {
  const backend = resolveStorageBackend(process.env.MANAGER_STORAGE_BACKEND, 'file')
  if (!isPostgresStorageEnabled(backend)) return
  void Promise.all([pingAgentPg(), hydrateManagerMemoryCache(600)]).catch(() => undefined)
})
