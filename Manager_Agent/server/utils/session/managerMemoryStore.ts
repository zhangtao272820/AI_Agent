import fs from 'node:fs/promises'
import path from 'node:path'
import { agentPgQuery } from '#agent-shared/agentPgClient'
import { recordMemory } from '#agent-shared/agentMemoryApi'
import { AMP_EXPERIENCE_SUCCESS_THRESHOLD } from '#agent-shared/agentMemoryPolicy'
import {
  isPostgresStorageEnabled,
  resolveStorageBackend,
  shouldWriteFile,
  shouldWritePostgres
} from '#agent-shared/storageBackend'

export function resolveManagerStorageBackend(env: NodeJS.ProcessEnv = process.env) {
  return resolveStorageBackend(env.MANAGER_STORAGE_BACKEND, 'file')
}

function memoryJsonlPath(): string {
  return path.join(process.cwd(), '.data', 'manager-memory.jsonl')
}

let memoryCache: Array<Record<string, unknown>> | null = null

export async function hydrateManagerMemoryCache(maxLines = 600): Promise<void> {
  const backend = resolveManagerStorageBackend()
  if (isPostgresStorageEnabled(backend)) {
    const res = await agentPgQuery<{ entry_type: string; ts: string; payload: Record<string, unknown> }>(
      `SELECT entry_type, ts, payload FROM mgr_memory_entries ORDER BY id DESC LIMIT $1`,
      [maxLines]
    )
    if (res) {
      memoryCache = res.rows.reverse().map((r) => ({
        ts: r.ts instanceof Date ? (r.ts as Date).toISOString() : String(r.ts),
        type: r.entry_type,
        ...r.payload
      }))
      return
    }
  }
  try {
    const raw = await fs.readFile(memoryJsonlPath(), 'utf8').catch(() => '')
    memoryCache = raw
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-maxLines)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
  } catch {
    memoryCache = []
  }
}

export function readManagerMemorySync(maxLines = 520): Array<Record<string, unknown>> {
  if (memoryCache?.length) return memoryCache.slice(-maxLines)
  return []
}

export async function appendManagerMemory(entry: Record<string, unknown>): Promise<void> {
  const backend = resolveManagerStorageBackend()
  const row = { ts: new Date().toISOString(), ...entry }
  const entryType = String(entry.type || 'experience').slice(0, 32)
  const payload = { ...entry }

  if (shouldWritePostgres(backend)) {
    await recordMemory(
      {
        type: entryType as 'experience' | 'working' | 'semantic' | 'reflection',
        agent: 'manager',
        successScore: Number(entry.successScore ?? entry.success_score),
        payload
      },
      process.env
    )
  }
  if (shouldWriteFile(backend)) {
    try {
      await fs.mkdir(path.join(process.cwd(), '.data'), { recursive: true })
      await fs.appendFile(memoryJsonlPath(), `${JSON.stringify(row)}\n`, 'utf8')
    } catch {
      /* ignore */
    }
  }
  if (!memoryCache) memoryCache = []
  memoryCache.push(row)
  if (memoryCache.length > 800) memoryCache = memoryCache.slice(-600)
}

export function experienceWriteThreshold(): number {
  return AMP_EXPERIENCE_SUCCESS_THRESHOLD
}
