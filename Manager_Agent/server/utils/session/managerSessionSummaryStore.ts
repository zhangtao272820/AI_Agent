import { agentPgQuery } from '#agent-shared/agentPgClient'
import {
  isPostgresStorageEnabled,
  resolveStorageBackend,
  shouldWritePostgres
} from '#agent-shared/storageBackend'

export type SessionSummarySource = 'rule' | 'llm'

export function resolveManagerStorageBackend(env: NodeJS.ProcessEnv = process.env) {
  return resolveStorageBackend(env.MANAGER_STORAGE_BACKEND, 'file')
}

export async function readSessionSummary(
  sessionId: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<{ summary: string; source: SessionSummarySource } | null> {
  const sid = String(sessionId || '').trim()
  if (!sid || !isPostgresStorageEnabled(resolveManagerStorageBackend(env))) return null
  const res = await agentPgQuery<{ summary: string; source: SessionSummarySource }>(
    `SELECT summary, source FROM mgr_session_summaries WHERE session_id = $1`,
    [sid],
    env
  )
  const row = res?.rows?.[0]
  if (!row?.summary) return null
  return { summary: row.summary, source: row.source }
}

export async function upsertSessionSummary(
  sessionId: string,
  summary: string,
  source: SessionSummarySource = 'rule',
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  const sid = String(sessionId || '').trim()
  const text = String(summary || '').trim()
  if (!sid || !text || !shouldWritePostgres(resolveManagerStorageBackend(env))) return

  await agentPgQuery(
    `INSERT INTO mgr_sessions (id, updated_at) VALUES ($1, NOW())
     ON CONFLICT (id) DO UPDATE SET updated_at = NOW()`,
    [sid],
    env
  )
  await agentPgQuery(
    `INSERT INTO mgr_session_summaries (session_id, summary, source, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (session_id) DO UPDATE SET summary = EXCLUDED.summary, source = EXCLUDED.source, updated_at = NOW()`,
    [sid, text.slice(0, 4000), source],
    env
  )
}
