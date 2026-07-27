/**
 * RAG 向量经验 PG 存储（jsonl 文件互补，Phase 14）
 */
import { agentPgQuery, isAgentPgConfigured } from '#agent-shared/agentPgClient'
import {
  isPostgresStorageEnabled,
  resolveStorageBackend,
  shouldWritePostgres
} from '#agent-shared/storageBackend'

export type RagExperienceVectorRow = {
  id: string
  questionNorm: string
  question: string
  hint: string
  vector: number[]
  sources?: string[]
  ts: string
}

export function resolveRagVectorPgEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const backend = resolveStorageBackend(env.RAG_AGENT_STORAGE_BACKEND, 'file')
  return isPostgresStorageEnabled(backend) || isAgentPgConfigured(env)
}

export async function upsertRagExperienceVectorPg(row: RagExperienceVectorRow): Promise<boolean> {
  if (!shouldWritePostgres(resolveStorageBackend(process.env.RAG_AGENT_STORAGE_BACKEND, 'file')) && !isAgentPgConfigured()) {
    return false
  }
  if (!isAgentPgConfigured()) return false
  const res = await agentPgQuery(
    `INSERT INTO rag_experience_vectors (id, question_norm, question, hint, vector, sources, ts, updated_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, NOW())
     ON CONFLICT (id) DO UPDATE SET
       hint = EXCLUDED.hint,
       vector = EXCLUDED.vector,
       sources = EXCLUDED.sources,
       updated_at = NOW()`,
    [
      String(row.id).slice(0, 80),
      String(row.questionNorm).slice(0, 120),
      String(row.question).slice(0, 500),
      String(row.hint).slice(0, 2000),
      JSON.stringify(row.vector),
      JSON.stringify(row.sources ?? []),
      row.ts || new Date().toISOString()
    ]
  )
  return Boolean(res)
}

export async function loadRagExperienceVectorsFromPg(maxRows = 400): Promise<RagExperienceVectorRow[]> {
  if (!isAgentPgConfigured()) return []
  const res = await agentPgQuery<{
    id: string
    question_norm: string
    question: string
    hint: string
    vector: unknown
    sources: unknown
    ts: string
  }>(
    `SELECT id, question_norm, question, hint, vector, sources, ts
     FROM rag_experience_vectors ORDER BY ts DESC LIMIT $1`,
    [maxRows]
  )
  return (res?.rows ?? [])
    .map((r) => ({
      id: r.id,
      questionNorm: r.question_norm,
      question: r.question,
      hint: r.hint,
      vector: Array.isArray(r.vector) ? r.vector.map(Number).filter((n) => Number.isFinite(n)) : [],
      sources: Array.isArray(r.sources) ? r.sources.map(String) : [],
      ts: r.ts
    }))
    .filter((r) => r.vector.length > 0)
}
