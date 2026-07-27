import { getDataSource } from '../../utils/db'
import { getDbMemoryStatus } from '../../utils/learning_signal_store'
import { resolveAgentRuntimeConfig } from '../../utils/runtime'
import { getAmpSummary } from '#agent-shared/agentMemoryPolicy'

/** 总管 probe：health=进程存活，ready=MySQL 可 ping + 记忆后端就绪 */
export default defineEventHandler(async (event) => {
  const runtimeConfig = useRuntimeConfig(event) as Record<string, unknown>
  try {
    const config = resolveAgentRuntimeConfig(runtimeConfig)
    const ds = await getDataSource(config)
    await ds.query('SELECT 1 AS ok')
    const dbName = String((ds.options as { database?: string })?.database ?? '')
    const memory = await getDbMemoryStatus()
    const amp = getAmpSummary()
    const memoryReady =
      memory.backend === 'file' ||
      (memory.backend === 'dual' && (!memory.pgConfigured || memory.pgReachable)) ||
      (memory.backend === 'postgres' && memory.pgConfigured && memory.pgReachable)
    const ready = memoryReady
    return {
      ok: true,
      ready,
      service: 'db_agent',
      database: dbName,
      memory: {
        backend: memory.backend,
        pgConfigured: memory.pgConfigured,
        pgReachable: memory.pgReachable,
        policyVersion: amp.version
      },
      detail: ready ? 'mysql_ping' : `memory_${memory.backend}_pg_unreachable`,
      ts: new Date().toISOString()
    }
  } catch (e: unknown) {
    const detail = String(e instanceof Error ? e.message : e ?? 'mysql_ping_failed').slice(0, 240)
    return {
      ok: false,
      ready: false,
      service: 'db_agent',
      detail,
      ts: new Date().toISOString()
    }
  }
})
