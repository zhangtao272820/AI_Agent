/** P2-7：可选 Redis checkpoint 后端（动态 import，缺包时回退 file） */

const CHECKPOINT_KEY_PREFIX = 'mgr:checkpoint:'
const CHECKPOINT_TTL_SEC = 24 * 60 * 60

export type CheckpointRedisOps = {
  get: (sessionId: string) => Promise<string | null>
  set: (sessionId: string, payload: string) => Promise<void>
  del: (sessionId: string) => Promise<void>
}

let redisOpsPromise: Promise<CheckpointRedisOps | null> | null = null

export function resolveCheckpointBackend(env: NodeJS.ProcessEnv = process.env): 'file' | 'redis' | 'dual' {
  const raw = String(env.MANAGER_CHECKPOINT_BACKEND || 'file').trim().toLowerCase()
  if (raw === 'redis') return 'redis'
  if (raw === 'dual') return 'dual'
  return 'file'
}

export function isCheckpointRedisEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const backend = resolveCheckpointBackend(env)
  return backend === 'redis' || backend === 'dual'
}

function checkpointRedisUrl(env: NodeJS.ProcessEnv = process.env): string {
  return String(env.REDIS_URL || env.MANAGER_REDIS_URL || '').trim()
}

function redisKey(sessionId: string): string {
  return `${CHECKPOINT_KEY_PREFIX}${sessionId}`
}

export async function getCheckpointRedisOps(): Promise<CheckpointRedisOps | null> {
  if (!isCheckpointRedisEnabled()) return null
  if (!checkpointRedisUrl()) return null
  if (!redisOpsPromise) {
    redisOpsPromise = (async () => {
      try {
        const { createClient } = (await import('redis')) as typeof import('redis')
        const client = createClient({ url: checkpointRedisUrl() })
        client.on('error', () => {})
        await client.connect()
        return {
          get: async (sessionId: string) => client.get(redisKey(sessionId)),
          set: async (sessionId: string, payload: string) => {
            await client.set(redisKey(sessionId), payload, { EX: CHECKPOINT_TTL_SEC })
          },
          del: async (sessionId: string) => {
            await client.del(redisKey(sessionId))
          }
        }
      } catch {
        return null
      }
    })()
  }
  return redisOpsPromise
}

export function resetCheckpointRedisForTests(): void {
  redisOpsPromise = null
}
