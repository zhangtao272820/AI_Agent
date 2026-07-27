import { existsSync, mkdirSync, readFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { agentPgQuery } from '#agent-shared/agentPgClient'
import {
  isPostgresStorageEnabled,
  resolveStorageBackend,
  shouldWriteFile,
  shouldWritePostgres
} from '#agent-shared/storageBackend'
import { isExperienceRecallConfirmedOnly, isConfirmedExperienceRow } from '#agent-shared/experienceRecallPolicy'

export type DbExperienceRow = {
  ts: string
  question_norm: string
  path?: string
  data_domain?: string
  blueprint_domain?: string
  tables?: string[]
  hint: string
  source?: string
  userConfirmed?: boolean
  status?: string
}

let experienceCache: DbExperienceRow[] | null = null

function experienceFile() {
  return join(process.cwd(), '.data', 'db-query-experience.jsonl')
}

function resolveBackend() {
  return resolveStorageBackend(process.env.DB_AGENT_STORAGE_BACKEND, 'file')
}

function readJsonl<T>(file: string, max = 500): T[] {
  if (!existsSync(file)) return []
  try {
    return readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-max)
      .map((l) => JSON.parse(l) as T)
  } catch {
    return []
  }
}

export async function hydrateDbExperienceCache(maxLines = 500): Promise<void> {
  const backend = resolveBackend()
  if (isPostgresStorageEnabled(backend)) {
    const res = await agentPgQuery<{
      ts: string
      question_norm: string
      path: string | null
      data_domain: string | null
      tables: string[] | null
      hint: string
    }>(
      `SELECT ts, question_norm, path, data_domain, tables, hint
       FROM db_query_experience ORDER BY id DESC LIMIT $1`,
      [maxLines]
    )
    if (res) {
      experienceCache = res.rows.reverse().map((r) => ({
        ts: r.ts instanceof Date ? r.ts.toISOString() : String(r.ts),
        question_norm: r.question_norm,
        path: r.path ?? undefined,
        data_domain: r.data_domain ?? undefined,
        tables: Array.isArray(r.tables) ? r.tables : undefined,
        hint: r.hint
      }))
      return
    }
  }
  experienceCache = readJsonl<DbExperienceRow>(experienceFile(), maxLines)
}

export function readDbExperienceSync(maxLines = 500): DbExperienceRow[] {
  if (experienceCache?.length) return experienceCache.slice(-maxLines)
  return readJsonl<DbExperienceRow>(experienceFile(), maxLines)
}

/** 召回专用：联邦门控时仅 confirmed 来源 */
export function readDbExperienceForRecall(maxLines = 500): DbExperienceRow[] {
  const all = readDbExperienceSync(maxLines)
  if (!isExperienceRecallConfirmedOnly()) return all
  return all.filter((r) => isConfirmedExperienceRow(r))
}

export async function persistDbExperience(row: DbExperienceRow): Promise<void> {
  const backend = resolveBackend()
  if (shouldWritePostgres(backend)) {
    await agentPgQuery(
      `INSERT INTO db_query_experience (ts, question_norm, path, data_domain, tables, hint)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        row.ts,
        row.question_norm,
        row.path ?? null,
        row.data_domain ?? null,
        row.tables ? JSON.stringify(row.tables) : null,
        row.hint
      ]
    )
  }
  if (shouldWriteFile(backend)) {
    try {
      const dir = join(process.cwd(), '.data')
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      appendFileSync(experienceFile(), `${JSON.stringify(row)}\n`, 'utf8')
    } catch {
      /* ignore */
    }
  }
  if (!experienceCache) experienceCache = []
  experienceCache.push(row)
  if (experienceCache.length > 600) experienceCache = experienceCache.slice(-500)
}
