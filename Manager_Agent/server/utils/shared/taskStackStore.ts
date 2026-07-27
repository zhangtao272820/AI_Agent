import { agentPgQuery } from '#agent-shared/agentPgClient'
import {
  isPostgresStorageEnabled,
  resolveStorageBackend,
  shouldWriteFile,
  shouldWritePostgres
} from '#agent-shared/storageBackend'
import type { TaskStack, TaskStackItem } from '../../graph/core/task/taskStack'

export function resolveManagerStorageBackend(env: NodeJS.ProcessEnv = process.env) {
  return resolveStorageBackend(env.MANAGER_STORAGE_BACKEND, 'file')
}

async function readTaskStackFromPg(sessionId: string): Promise<TaskStack | null> {
  const sid = String(sessionId || '').trim()
  if (!sid) return null
  const res = await agentPgQuery<{ items: TaskStackItem[]; updated_at: string }>(
    `SELECT items, updated_at FROM mgr_task_stacks WHERE session_id = $1`,
    [sid]
  )
  if (!res?.rows?.[0]) return null
  const row = res.rows[0]
  return {
    sessionId: sid,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
    items: Array.isArray(row.items) ? row.items : []
  }
}

async function writeTaskStackToPg(stack: TaskStack): Promise<boolean> {
  const sid = String(stack.sessionId || '').trim()
  if (!sid) return false
  await agentPgQuery(
    `INSERT INTO mgr_sessions (id, updated_at) VALUES ($1, NOW())
     ON CONFLICT (id) DO UPDATE SET updated_at = NOW()`,
    [sid]
  )
  const res = await agentPgQuery(
    `INSERT INTO mgr_task_stacks (session_id, items, updated_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (session_id) DO UPDATE SET
       items = EXCLUDED.items,
       updated_at = EXCLUDED.updated_at`,
    [sid, JSON.stringify(stack.items ?? []), stack.updatedAt || new Date().toISOString()]
  )
  return Boolean(res)
}

/** PG 优先读取 task stack */
export async function readTaskStackHybrid(
  sessionId: string,
  fileLoader: () => Promise<TaskStack>
): Promise<TaskStack> {
  const backend = resolveManagerStorageBackend()
  if (isPostgresStorageEnabled(backend)) {
    const pg = await readTaskStackFromPg(sessionId)
    if (pg) return pg
  }
  return fileLoader()
}

/** 双写 task stack（PG + 文件） */
export async function writeTaskStackHybrid(
  stack: TaskStack,
  fileWriter: (stack: TaskStack) => Promise<TaskStack>
): Promise<TaskStack> {
  const backend = resolveManagerStorageBackend()
  let next = stack
  if (shouldWriteFile(backend)) {
    next = await fileWriter(stack)
  }
  if (shouldWritePostgres(backend)) {
    await writeTaskStackToPg(next)
  }
  return next
}
