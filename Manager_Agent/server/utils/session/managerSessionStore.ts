import fs from 'node:fs/promises'
import path from 'node:path'
import { agentPgQuery } from '#agent-shared/agentPgClient'
import { AMP_TTL } from '#agent-shared/agentMemoryPolicy'
import {
  isPostgresStorageEnabled,
  resolveStorageBackend,
  shouldWriteFile,
  shouldWritePostgres
} from '#agent-shared/storageBackend'

export type SessionMessage = { role: 'user' | 'assistant'; content: string }
export type ManagerSession = { messages: SessionMessage[] }

const SESSION_MAX_TURNS = AMP_TTL.sessionTurnsMax

function sessionsDir(): string {
  return path.join(process.cwd(), '.data', 'sessions')
}

function sessionFile(sessionId: string): string {
  return path.join(sessionsDir(), `${sessionId}.json`)
}

function normalizeMessages(raw: unknown): SessionMessage[] {
  const arr = Array.isArray((raw as { messages?: unknown })?.messages)
    ? (raw as { messages: unknown[] }).messages
    : Array.isArray(raw)
      ? raw
      : []
  return arr
    .map((m: { role?: string; content?: string }) => ({
      role: m?.role === 'assistant' ? ('assistant' as const) : ('user' as const),
      content: String(m?.content ?? '').trim()
    }))
    .filter((m) => m.content)
    .slice(-SESSION_MAX_TURNS)
}

export function resolveManagerStorageBackend(env: NodeJS.ProcessEnv = process.env) {
  return resolveStorageBackend(env.MANAGER_STORAGE_BACKEND, 'file')
}

async function readSessionFromFile(sessionId: string): Promise<ManagerSession> {
  const sid = String(sessionId || '').trim()
  if (!sid) return { messages: [] }
  try {
    const text = await fs.readFile(sessionFile(sid), 'utf8').catch(() => '')
    if (!text.trim()) return { messages: [] }
    return { messages: normalizeMessages(JSON.parse(text)) }
  } catch {
    return { messages: [] }
  }
}

async function writeSessionToFile(sessionId: string, messages: SessionMessage[]): Promise<void> {
  const sid = String(sessionId || '').trim()
  if (!sid) return
  const dir = sessionsDir()
  await fs.mkdir(dir, { recursive: true }).catch(() => undefined)
  await fs.writeFile(
    sessionFile(sid),
    JSON.stringify({ messages: messages.slice(-SESSION_MAX_TURNS) }, null, 2),
    'utf8'
  )
}

function mapPgTurnRows(rows: Array<{ role: string; content: string }>): SessionMessage[] {
  return rows
    .map((r) => ({
      role: r.role === 'assistant' ? ('assistant' as const) : ('user' as const),
      content: String(r.content ?? '').trim()
    }))
    .filter((m) => m.content)
}

async function readSessionFromPg(sessionId: string): Promise<ManagerSession | null> {
  const sid = String(sessionId || '').trim()
  if (!sid) return null
  const res = await agentPgQuery<{ role: string; content: string }>(
    `SELECT role, content FROM mgr_session_turns
     WHERE session_id = $1
     ORDER BY turn_index ASC
     LIMIT $2`,
    [sid, SESSION_MAX_TURNS]
  )
  if (!res) return null
  const live = mapPgTurnRows(res.rows)
  if (live.length) return { messages: live }

  // 冷归档后热表为空：回读 archive，避免 resume 看到空历史
  const archived = await agentPgQuery<{ role: string; content: string }>(
    `SELECT role, content FROM mgr_session_turns_archive
     WHERE session_id = $1
     ORDER BY turn_index ASC
     LIMIT $2`,
    [sid, SESSION_MAX_TURNS]
  )
  if (!archived) return { messages: [] }
  return { messages: mapPgTurnRows(archived.rows) }
}

async function writeSessionToPg(sessionId: string, messages: SessionMessage[]): Promise<boolean> {
  const sid = String(sessionId || '').trim()
  if (!sid) return false
  const capped = messages.slice(-SESSION_MAX_TURNS)

  const upsertSession = await agentPgQuery(
    `INSERT INTO mgr_sessions (id, updated_at)
     VALUES ($1, NOW())
     ON CONFLICT (id) DO UPDATE SET updated_at = NOW()`,
    [sid]
  )
  if (!upsertSession) return false

  const del = await agentPgQuery(`DELETE FROM mgr_session_turns WHERE session_id = $1`, [sid])
  if (!del) return false

  for (let i = 0; i < capped.length; i++) {
    const m = capped[i]!
    const ins = await agentPgQuery(
      `INSERT INTO mgr_session_turns (session_id, turn_index, role, content)
       VALUES ($1, $2, $3, $4)`,
      [sid, i, m.role, m.content]
    )
    if (!ins) return false
  }
  return true
}

/** 读取会话：PG 优先（含 archive）；热表/归档皆空或 PG 不可达时回退文件 */
export async function readManagerSession(sessionId: string): Promise<ManagerSession> {
  const backend = resolveManagerStorageBackend()
  if (isPostgresStorageEnabled(backend)) {
    const pg = await readSessionFromPg(sessionId)
    if (pg && pg.messages.length) return pg
    // PG 连通但为空（或不可达返回 null）时仍试文件，恢复 .data 残留
  }
  return readSessionFromFile(sessionId)
}

/** 写入会话：按 backend 写 file / postgres / dual；PG 失败时强制落盘 */
export async function writeManagerSession(sessionId: string, session: ManagerSession): Promise<void> {
  const backend = resolveManagerStorageBackend()
  const messages = session.messages.slice(-SESSION_MAX_TURNS)

  let pgOk = false
  if (shouldWritePostgres(backend)) {
    try {
      pgOk = await writeSessionToPg(sessionId, messages)
    } catch {
      pgOk = false
    }
  }

  const needFile = shouldWriteFile(backend) || (shouldWritePostgres(backend) && !pgOk)
  if (needFile) {
    try {
      await writeSessionToFile(sessionId, messages)
    } catch {
      /* ignore */
    }
  }
}

/** 删除会话：PG CASCADE + 关联向量；文件由 session-delete 另行清理 */
export async function deleteManagerSession(sessionId: string): Promise<{ pg: boolean }> {
  const sid = String(sessionId || '').trim()
  if (!sid) return { pg: false }
  const backend = resolveManagerStorageBackend()
  if (!isPostgresStorageEnabled(backend)) return { pg: false }

  await agentPgQuery(
    `DELETE FROM mgr_memory_embeddings
     WHERE metadata->>'sessionId' = $1 OR user_key = $1`,
    [sid]
  ).catch(() => undefined)
  const del = await agentPgQuery(`DELETE FROM mgr_sessions WHERE id = $1`, [sid])
  return { pg: Boolean(del) }
}

/** ready/healthcheck 轮询共用：避免每次抢 PG 池 */
const MEMORY_STATUS_TTL_MS = 2_500
let memoryStatusCache:
  | {
      at: number
      value: {
        backend: ReturnType<typeof resolveManagerStorageBackend>
        pgConfigured: boolean
        pgReachable: boolean
      }
    }
  | null = null

export async function getManagerMemoryStatus(): Promise<{
  backend: ReturnType<typeof resolveManagerStorageBackend>
  pgConfigured: boolean
  pgReachable: boolean
}> {
  const now = Date.now()
  if (memoryStatusCache && now - memoryStatusCache.at < MEMORY_STATUS_TTL_MS) {
    return memoryStatusCache.value
  }

  const backend = resolveManagerStorageBackend()
  const { isAgentPgConfigured, pingAgentPg } = await import('#agent-shared/agentPgClient')
  const pgConfigured = isAgentPgConfigured()
  let pgReachable = false
  if (pgConfigured && isPostgresStorageEnabled(backend)) {
    pgReachable = await pingAgentPg()
  }
  const value = { backend, pgConfigured, pgReachable }
  memoryStatusCache = { at: now, value }
  return value
}
