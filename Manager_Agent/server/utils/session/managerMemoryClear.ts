/**
 * Manager 记忆/进化清除（PG + 文件 fallback）
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { agentPgQuery } from '#agent-shared/agentPgClient'
import { isPostgresStorageEnabled, resolveStorageBackend } from '#agent-shared/storageBackend'
import { clearActivePromptPatches } from '../../graph/core/evolution/promptPatches'

export type MemoryClearScope = 'experience' | 'summaries' | 'evolution' | 'all'

function policyDir() {
  return path.join(process.cwd(), '.data')
}

function pgEnabled() {
  return isPostgresStorageEnabled(resolveStorageBackend(process.env.MANAGER_STORAGE_BACKEND, 'file'))
}

export async function clearManagerExperience(): Promise<{ removed: number }> {
  let removed = 0
  const dir = policyDir()

  if (pgEnabled()) {
    const exp = await agentPgQuery<{ n: string }>(
      `WITH d AS (
         DELETE FROM mgr_memory_entries WHERE entry_type = 'experience' RETURNING 1
       ) SELECT COUNT(*)::text AS n FROM d`
    )
    removed += Number(exp?.rows?.[0]?.n) || 0
    await agentPgQuery(`DELETE FROM mgr_memory_embeddings WHERE entry_type = 'experience'`).catch(() => undefined)
  }

  const memJsonl = path.join(dir, 'manager-memory.jsonl')
  const raw = await fs.readFile(memJsonl, 'utf8').catch(() => '')
  if (raw.trim()) {
    const kept: string[] = []
    for (const line of raw.split('\n')) {
      const s = line.trim()
      if (!s) continue
      try {
        const obj = JSON.parse(s)
        if (obj?.type === 'experience') {
          removed += 1
          continue
        }
        kept.push(JSON.stringify(obj))
      } catch {
        kept.push(s)
      }
    }
    await fs.writeFile(memJsonl, kept.length ? `${kept.join('\n')}\n` : '', 'utf8').catch(() => undefined)
  }

  await fs.unlink(path.join(dir, 'manager-policy.json')).catch(() => undefined)
  return { removed }
}

export async function clearManagerSummaries(sessionIds?: string[]): Promise<{ cleared: number }> {
  let cleared = 0
  if (pgEnabled()) {
    if (sessionIds?.length) {
      const res = await agentPgQuery<{ n: string }>(
        `WITH d AS (
           DELETE FROM mgr_session_summaries WHERE session_id = ANY($1::varchar[]) RETURNING 1
         ) SELECT COUNT(*)::text AS n FROM d`,
        [sessionIds]
      )
      cleared = Number(res?.rows?.[0]?.n) || 0
    } else {
      const res = await agentPgQuery<{ n: string }>(
        `WITH d AS (DELETE FROM mgr_session_summaries RETURNING 1) SELECT COUNT(*)::text AS n FROM d`
      )
      cleared = Number(res?.rows?.[0]?.n) || 0
    }
  }
  return { cleared }
}

export async function clearManagerEvolution(): Promise<{ ok: true }> {
  const dir = policyDir()
  if (pgEnabled()) {
    await agentPgQuery(`DELETE FROM evo_policy_versions`).catch(() => undefined)
    await agentPgQuery(`DELETE FROM evo_audit_runs`).catch(() => undefined)
    await agentPgQuery(`DELETE FROM evo_curator_state`).catch(() => undefined)
  }
  await clearActivePromptPatches(dir).catch(() => undefined)
  for (const name of [
    'manager-prompt-patches.json',
    'manager-prompt-patches.shadow.json',
    'manager-planner-rules.json',
    'manager-planner-rules.shadow.json'
  ]) {
    await fs.unlink(path.join(dir, name)).catch(() => undefined)
  }
  return { ok: true }
}

export async function clearManagerMemory(scope: MemoryClearScope, sessionIds?: string[]) {
  if (scope === 'experience') return { scope, ...(await clearManagerExperience()) }
  if (scope === 'summaries') return { scope, ...(await clearManagerSummaries(sessionIds)) }
  if (scope === 'evolution') return { scope, ...(await clearManagerEvolution()) }
  const exp = await clearManagerExperience()
  const summaries = await clearManagerSummaries(sessionIds)
  const evo = await clearManagerEvolution()
  if (pgEnabled()) {
    await agentPgQuery(`DELETE FROM mgr_memory_entries WHERE entry_type IN ('semantic', 'reflection', 'working')`).catch(
      () => undefined
    )
    await agentPgQuery(`DELETE FROM mgr_memory_embeddings`).catch(() => undefined)
  }
  return { scope, ...exp, ...summaries, evolution: evo }
}

async function postAgentReset(baseUrl: string, scope: string) {
  const token = String(process.env.CLAWHIVE_INTERNAL_TOKEN || '').trim()
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (token) headers['x-clawhive-internal-token'] = token
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/learning/reset`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ scope }),
      signal: AbortSignal.timeout(12_000)
    })
    return { ok: res.ok, status: res.status }
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e) }
  }
}

/** 编排模式下顺带清 DB/RAG 学习与进化（不影响 RAG 文档向量库） */
export async function clearSubAgentLearning(scope: 'learning' | 'all' = 'all') {
  const dbUrl = String(process.env.DB_AGENT_HTTP_URL || 'http://localhost:13101')
  const ragUrl = String(process.env.RAG_AGENT_HTTP_URL || 'http://localhost:13102')
  const resetScope = scope === 'all' ? 'all' : 'learning'
  const [db, rag] = await Promise.all([
    postAgentReset(dbUrl, resetScope),
    postAgentReset(ragUrl, resetScope)
  ])
  return { db, rag }
}
