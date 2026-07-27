import { getAmpSummary } from '#agent-shared/agentMemoryPolicy'
import { getManagerMemoryStatus } from '../utils/session/managerSessionStore'

/** 总管 probe：health=进程存活，ready=记忆存储后端可达（postgres 模式需 PG ping） */
export default defineEventHandler(async () => {
  const memory = await getManagerMemoryStatus()
  const amp = getAmpSummary()
  const ready =
    memory.backend === 'file' ||
    (memory.backend === 'dual' && (!memory.pgConfigured || memory.pgReachable)) ||
    (memory.backend === 'postgres' && memory.pgConfigured && memory.pgReachable)

  return {
    ok: true,
    ready,
    service: 'manager_agent',
    memory: {
      backend: memory.backend,
      pgConfigured: memory.pgConfigured,
      pgReachable: memory.pgReachable,
      policyVersion: amp.version
    },
    detail: ready ? `memory_${memory.backend}` : `memory_${memory.backend}_pg_unreachable`,
    ts: new Date().toISOString()
  }
})
