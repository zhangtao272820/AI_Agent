import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { agentPgQuery } from '#agent-shared/agentPgClient'
import {
  isPostgresStorageEnabled,
  resolveStorageBackend,
  shouldWriteFile,
  shouldWritePostgres
} from '#agent-shared/storageBackend'

export type RagLearningSignalRow = {
  question: string
  question_norm?: string
  score: number
  comment?: string
  path?: string
  source?: string
  at: string
}

let signalsCache: RagLearningSignalRow[] | null = null

function dataDir() {
  const dir = join(process.cwd(), '.data')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function signalsFilePath() {
  return join(dataDir(), 'rag-learning-signals.jsonl')
}

export function resolveRagStorageBackend(env: NodeJS.ProcessEnv = process.env) {
  return resolveStorageBackend(env.RAG_AGENT_STORAGE_BACKEND, 'file')
}

function readJsonlLines<T>(file: string, maxLines = 500): T[] {
  if (!existsSync(file)) return []
  try {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean)
    const slice = lines.slice(-maxLines)
    const out: T[] = []
    for (const line of slice) {
      try {
        out.push(JSON.parse(line) as T)
      } catch {
        /* skip */
      }
    }
    return out
  } catch {
    return []
  }
}

function appendSignalToFile(row: RagLearningSignalRow): void {
  try {
    appendFileSync(signalsFilePath(), `${JSON.stringify(row)}\n`, 'utf8')
  } catch {
    /* ignore */
  }
}

async function appendSignalToPg(row: RagLearningSignalRow): Promise<boolean> {
  const res = await agentPgQuery(
    `INSERT INTO rag_learning_signals
      (at, question, question_norm, score, comment, path, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      row.at,
      row.question,
      row.question_norm ?? null,
      row.score,
      row.comment ?? null,
      row.path ?? null,
      row.source ?? null
    ]
  )
  return Boolean(res)
}

async function readSignalsFromPg(maxLines = 500): Promise<RagLearningSignalRow[] | null> {
  const res = await agentPgQuery<{
    at: string
    question: string
    question_norm: string | null
    score: number
    comment: string | null
    path: string | null
    source: string | null
  }>(
    `SELECT at, question, question_norm, score, comment, path, source
     FROM rag_learning_signals
     ORDER BY id DESC
     LIMIT $1`,
    [maxLines]
  )
  if (!res) return null
  return res.rows.reverse().map((r) => ({
    at: r.at instanceof Date ? r.at.toISOString() : String(r.at),
    question: r.question,
    question_norm: r.question_norm ?? undefined,
    score: Number(r.score),
    comment: r.comment ?? undefined,
    path: r.path ?? undefined,
    source: r.source ?? undefined
  }))
}

export async function readRagLearningSignalsAsync(maxLines = 500): Promise<RagLearningSignalRow[]> {
  const backend = resolveRagStorageBackend()
  if (isPostgresStorageEnabled(backend)) {
    const pg = await readSignalsFromPg(maxLines)
    if (pg?.length) return pg
    if (backend === 'postgres' && pg) return pg
  }
  return readJsonlLines<RagLearningSignalRow>(signalsFilePath(), maxLines)
}

export async function hydrateRagSignalsCache(maxLines = 600): Promise<void> {
  signalsCache = await readRagLearningSignalsAsync(maxLines)
}

export function invalidateRagSignalsCache(): void {
  signalsCache = null
}

export function readRagLearningSignalsSync(maxLines = 500): RagLearningSignalRow[] {
  const backend = resolveRagStorageBackend()
  if (isPostgresStorageEnabled(backend) && signalsCache?.length) {
    return signalsCache.slice(-maxLines)
  }
  return readJsonlLines<RagLearningSignalRow>(signalsFilePath(), maxLines)
}

export async function persistRagLearningSignal(row: RagLearningSignalRow): Promise<void> {
  const backend = resolveRagStorageBackend()
  if (shouldWritePostgres(backend)) {
    try {
      await appendSignalToPg(row)
    } catch {
      /* fallback */
    }
  }
  if (shouldWriteFile(backend)) {
    appendSignalToFile(row)
  }
  if (signalsCache) {
    signalsCache.push(row)
    if (signalsCache.length > 800) signalsCache = signalsCache.slice(-600)
  }
}

export async function getRagMemoryStatus(): Promise<{
  backend: ReturnType<typeof resolveRagStorageBackend>
  pgConfigured: boolean
  pgReachable: boolean
}> {
  const backend = resolveRagStorageBackend()
  const { isAgentPgConfigured, pingAgentPg } = await import('#agent-shared/agentPgClient')
  const pgConfigured = isAgentPgConfigured()
  let pgReachable = false
  if (pgConfigured && isPostgresStorageEnabled(backend)) {
    pgReachable = await pingAgentPg()
  }
  return { backend, pgConfigured, pgReachable }
}
