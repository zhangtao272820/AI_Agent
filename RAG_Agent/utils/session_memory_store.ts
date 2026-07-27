import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { agentPgQuery } from '#agent-shared/agentPgClient'
import {
  isPostgresStorageEnabled,
  resolveStorageBackend,
  shouldWriteFile,
  shouldWritePostgres
} from '#agent-shared/storageBackend'

export type LayeredSessionMemory = {
  summary: string
  topics: string[]
  updatedAt: number
}

const MAX_SESSIONS = 200
const SESSION_TTL_MS = 1000 * 60 * 60 * 6

let sessionCache: Record<string, LayeredSessionMemory> | null = null

function resolveBackend() {
  return resolveStorageBackend(process.env.RAG_AGENT_STORAGE_BACKEND, 'file')
}

function memoryFile() {
  const dir = join(process.cwd(), '.data')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'rag-session-memory.json')
}

function loadFileStore(): Record<string, LayeredSessionMemory> {
  const p = memoryFile()
  if (!existsSync(p)) return {}
  try {
    const o = JSON.parse(readFileSync(p, 'utf8'))
    return o && typeof o === 'object' ? (o as Record<string, LayeredSessionMemory>) : {}
  } catch {
    return {}
  }
}

function saveFileStore(store: Record<string, LayeredSessionMemory>) {
  if (!shouldWriteFile(resolveBackend())) return
  const now = Date.now()
  const entries = Object.entries(store).filter(([, v]) => now - (v.updatedAt ?? 0) <= SESSION_TTL_MS)
  entries.sort((a, b) => (b[1].updatedAt ?? 0) - (a[1].updatedAt ?? 0))
  writeFileSync(memoryFile(), JSON.stringify(Object.fromEntries(entries.slice(0, MAX_SESSIONS)), null, 0), 'utf8')
}

export async function hydrateRagSessionMemoryCache(): Promise<void> {
  const backend = resolveBackend()
  if (isPostgresStorageEnabled(backend)) {
    const res = await agentPgQuery<{
      session_id: string
      summary: string
      topics: string[]
      updated_at: string
    }>(`SELECT session_id, summary, topics, updated_at FROM rag_session_memory`)
    if (res) {
      const store: Record<string, LayeredSessionMemory> = {}
      const now = Date.now()
      for (const r of res.rows) {
        const updatedAt = r.updated_at instanceof Date ? r.updated_at.getTime() : Date.parse(String(r.updated_at))
        if (now - updatedAt > SESSION_TTL_MS) continue
        store[r.session_id] = {
          summary: r.summary,
          topics: Array.isArray(r.topics) ? r.topics : [],
          updatedAt: Number.isFinite(updatedAt) ? updatedAt : now
        }
      }
      sessionCache = store
      return
    }
  }
  sessionCache = loadFileStore()
}

function getStore(): Record<string, LayeredSessionMemory> {
  if (!sessionCache) sessionCache = loadFileStore()
  return sessionCache
}

async function persistSession(id: string, mem: LayeredSessionMemory): Promise<void> {
  const backend = resolveBackend()
  if (shouldWritePostgres(backend)) {
    await agentPgQuery(
      `INSERT INTO rag_session_memory (session_id, summary, topics, updated_at)
       VALUES ($1,$2,$3,to_timestamp($4/1000.0))
       ON CONFLICT (session_id) DO UPDATE SET
         summary = EXCLUDED.summary,
         topics = EXCLUDED.topics,
         updated_at = EXCLUDED.updated_at`,
      [id, mem.summary, JSON.stringify(mem.topics), mem.updatedAt]
    )
  }
  saveFileStore(getStore())
}

export function getRagSessionMemoryPg(sessionId: string): LayeredSessionMemory {
  const id = String(sessionId || '').trim()
  if (!id) return { summary: '', topics: [], updatedAt: Date.now() }
  const store = getStore()
  const hit = store[id]
  if (!hit) return { summary: '', topics: [], updatedAt: Date.now() }
  if (Date.now() - hit.updatedAt > SESSION_TTL_MS) {
    delete store[id]
    void persistSession(id, { summary: '', topics: [], updatedAt: Date.now() }).catch(() => undefined)
    return { summary: '', topics: [], updatedAt: Date.now() }
  }
  return hit
}

export function updateRagSessionMemoryPg(
  sessionId: string,
  patch: Partial<Pick<LayeredSessionMemory, 'summary' | 'topics'>>
) {
  const id = String(sessionId || '').trim()
  if (!id) return
  const store = getStore()
  const prev = store[id] ?? { summary: '', topics: [], updatedAt: Date.now() }
  store[id] = {
    summary: patch.summary !== undefined ? patch.summary : prev.summary,
    topics: patch.topics !== undefined ? patch.topics : prev.topics,
    updatedAt: Date.now()
  }
  void persistSession(id, store[id]!).catch(() => undefined)
}

export function clearRagSessionMemoryPg(sessionId: string) {
  const id = String(sessionId || '').trim()
  if (!id) return
  const store = getStore()
  delete store[id]
  const backend = resolveBackend()
  if (shouldWritePostgres(backend)) {
    void agentPgQuery(`DELETE FROM rag_session_memory WHERE session_id = $1`, [id]).catch(() => undefined)
  }
  saveFileStore(store)
}
