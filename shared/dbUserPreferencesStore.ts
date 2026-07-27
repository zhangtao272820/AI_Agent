/**
 * DB 用户偏好 PG 存储 + internal user-context 数据源
 */

import { agentPgQuery } from './agentPgClient'
import { resolveUserKey, type UserKeyInput } from './resolveUserKey'
import {
  isPostgresStorageEnabled,
  resolveStorageBackend,
  shouldWriteFile,
  shouldWritePostgres
} from './storageBackend'

export type DbUserPreferencesPayload = {
  updated_at?: string
  default_time_relative?: string
  preferred_data_domain?: string
  frequent_names?: string[]
  frequent_metrics?: string[]
  query_count?: number
}

function resolveBackend(env: NodeJS.ProcessEnv = process.env) {
  return resolveStorageBackend(env.DB_AGENT_STORAGE_BACKEND, 'file')
}

export function normalizeDbUserKey(input?: UserKeyInput | string): string {
  if (typeof input === 'string') {
    const k = String(input || '').trim().slice(0, 64)
    return k || '__global__'
  }
  return resolveUserKey(input ?? {})
}

export async function readDbUserPreferencesPg(
  userKey: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<DbUserPreferencesPayload | null> {
  const res = await agentPgQuery<{ payload: DbUserPreferencesPayload }>(
    `SELECT payload FROM db_user_preferences WHERE user_key = $1`,
    [userKey],
    env
  )
  return res?.rows?.[0]?.payload ?? null
}

export async function upsertDbUserPreferencesPg(
  userKey: string,
  payload: DbUserPreferencesPayload,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  await agentPgQuery(
    `INSERT INTO db_user_preferences (user_key, payload, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (user_key) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()`,
    [userKey, JSON.stringify({ ...payload, updated_at: new Date().toISOString() })],
    env
  )
}

export async function listDbUserPreferenceKeys(
  env: NodeJS.ProcessEnv = process.env
): Promise<string[]> {
  const res = await agentPgQuery<{ user_key: string }>(
    `SELECT user_key FROM db_user_preferences ORDER BY updated_at DESC LIMIT 200`,
    [],
    env
  )
  return (res?.rows ?? []).map((r) => r.user_key)
}

export function isDbUserPreferencesPgEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isPostgresStorageEnabled(resolveBackend(env))
}

export { shouldWriteFile, shouldWritePostgres, resolveBackend as resolveDbStorageBackend }
