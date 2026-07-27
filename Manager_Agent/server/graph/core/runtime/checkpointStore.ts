import fs from 'node:fs/promises'
import path from 'node:path'
import { getCheckpointRedisOps, resolveCheckpointBackend } from './checkpointRedis'

const CHECKPOINT_TTL_MS = 24 * 60 * 60 * 1000
const mem = new Map<string, { checkpoint: unknown; savedAt: number }>()

function checkpointFile(sessionId: string): string {
  return path.join(process.cwd(), '.data', 'checkpoints', `${sessionId}.json`)
}

function parseCheckpointPayload(text: string): { savedAt: number; checkpoint: unknown } | null {
  try {
    const obj = JSON.parse(text) as { savedAt?: number; checkpoint?: unknown }
    return {
      savedAt: Number(obj.savedAt) || Date.now(),
      checkpoint: obj.checkpoint
    }
  } catch {
    return null
  }
}

async function writeFileCheckpoint(sessionId: string, savedAt: number, checkpoint: unknown): Promise<void> {
  const dir = path.join(process.cwd(), '.data', 'checkpoints')
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(checkpointFile(sessionId), JSON.stringify({ savedAt, checkpoint }), 'utf8')
}

async function writeRedisCheckpoint(sessionId: string, savedAt: number, checkpoint: unknown): Promise<void> {
  const redis = await getCheckpointRedisOps()
  if (!redis) return
  await redis.set(sessionId, JSON.stringify({ savedAt, checkpoint }))
}

export async function saveHumanConfirmCheckpoint(sessionId: string, checkpoint: unknown): Promise<void> {
  const sid = String(sessionId || '').trim()
  if (!sid) return
  const savedAt = Date.now()
  mem.set(sid, { checkpoint, savedAt })
  const payload = JSON.stringify({ savedAt, checkpoint })
  const backend = resolveCheckpointBackend()

  if (backend !== 'redis') {
    try {
      await writeFileCheckpoint(sid, savedAt, checkpoint)
    } catch {
      /* 内存仍可用 */
    }
  }

  if (backend === 'redis' || backend === 'dual') {
    try {
      await writeRedisCheckpoint(sid, savedAt, checkpoint)
    } catch {
      if (backend === 'redis') {
        try {
          await writeFileCheckpoint(sid, savedAt, checkpoint)
        } catch {}
      }
    }
  }
}

export async function loadHumanConfirmCheckpoint(sessionId: string): Promise<unknown | undefined> {
  const sid = String(sessionId || '').trim()
  if (!sid) return undefined

  const cached = mem.get(sid)
  if (cached && Date.now() - cached.savedAt < CHECKPOINT_TTL_MS) return cached.checkpoint

  const backend = resolveCheckpointBackend()

  if (backend === 'redis' || backend === 'dual') {
    try {
      const redis = await getCheckpointRedisOps()
      if (redis) {
        const text = await redis.get(sid)
        if (text) {
          const parsed = parseCheckpointPayload(text)
          if (parsed && Date.now() - parsed.savedAt < CHECKPOINT_TTL_MS) {
            mem.set(sid, { checkpoint: parsed.checkpoint, savedAt: parsed.savedAt })
            return parsed.checkpoint
          }
          if (parsed && Date.now() - parsed.savedAt >= CHECKPOINT_TTL_MS) {
            await deleteHumanConfirmCheckpoint(sid)
            return undefined
          }
        }
      }
    } catch {}
  }

  if (backend !== 'redis') {
    try {
      const text = await fs.readFile(checkpointFile(sid), 'utf8')
      const obj = parseCheckpointPayload(text)
      if (!obj) return cached?.checkpoint
      if (Date.now() - obj.savedAt > CHECKPOINT_TTL_MS) {
        await deleteHumanConfirmCheckpoint(sid)
        return undefined
      }
      mem.set(sid, { checkpoint: obj.checkpoint, savedAt: obj.savedAt })
      return obj.checkpoint
    } catch {
      return cached?.checkpoint
    }
  }

  return cached?.checkpoint
}

export async function deleteHumanConfirmCheckpoint(sessionId: string): Promise<void> {
  const sid = String(sessionId || '').trim()
  if (!sid) return
  mem.delete(sid)

  const backend = resolveCheckpointBackend()
  if (backend !== 'redis') {
    try {
      await fs.unlink(checkpointFile(sid))
    } catch {}
  }
  if (backend === 'redis' || backend === 'dual') {
    try {
      const redis = await getCheckpointRedisOps()
      if (redis) await redis.del(sid)
    } catch {}
  }
}
