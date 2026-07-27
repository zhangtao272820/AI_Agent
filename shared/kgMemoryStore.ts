/**
 * P3：跨 Agent 知识图谱 — 实体/关系 PG 存储 + Planner 召回
 */
import { agentPgQuery, isAgentPgConfigured } from './agentPgClient'
import { normalizeDbQuestionKey } from './dbExperienceBridge'
import { normalizeTenantId } from './tenantScope'

export type KgEntityType = 'question' | 'db_table' | 'rag_source' | 'code_file' | 'crawl_site' | 'admin_scenario' | 'agent'

export type KgEntityRow = {
  id: number
  entityType: string
  entityKey: string
  label: string
  sourceAgent?: string
}

export function isKgMemoryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.MGR_KG_MEMORY ?? '1').trim() !== '0'
}

async function upsertEntity(
  input: {
    tenantId: string
    entityType: KgEntityType
    entityKey: string
    label?: string
    sourceAgent?: string
    runId?: string
    metadata?: Record<string, unknown>
  },
  env: NodeJS.ProcessEnv
): Promise<number | null> {
  const tenantId = normalizeTenantId(input.tenantId, env)
  const entityKey = String(input.entityKey || '').trim().slice(0, 256)
  if (!entityKey) return null
  const res = await agentPgQuery<{ id: string }>(
    `INSERT INTO mgr_kg_entities (tenant_id, entity_type, entity_key, label, source_agent, metadata, last_run_id, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, NOW())
     ON CONFLICT (tenant_id, entity_type, entity_key) DO UPDATE SET
       label = COALESCE(EXCLUDED.label, mgr_kg_entities.label),
       source_agent = COALESCE(EXCLUDED.source_agent, mgr_kg_entities.source_agent),
       metadata = mgr_kg_entities.metadata || EXCLUDED.metadata,
       last_run_id = COALESCE(EXCLUDED.last_run_id, mgr_kg_entities.last_run_id),
       updated_at = NOW()
     RETURNING id`,
    [
      tenantId,
      input.entityType,
      entityKey,
      input.label?.slice(0, 512) ?? entityKey.slice(0, 512),
      input.sourceAgent?.slice(0, 32) ?? null,
      JSON.stringify(input.metadata || {}),
      input.runId?.slice(0, 80) ?? null
    ],
    env
  )
  return res?.rows?.[0] ? Number(res.rows[0].id) : null
}

async function upsertEdge(
  input: {
    tenantId: string
    srcId: number
    rel: string
    dstId: number
    runId?: string
    weight?: number
  },
  env: NodeJS.ProcessEnv
): Promise<void> {
  if (!input.srcId || !input.dstId) return
  await agentPgQuery(
    `INSERT INTO mgr_kg_edges (tenant_id, src_entity_id, rel, dst_entity_id, run_id, weight, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [
      normalizeTenantId(input.tenantId, env),
      input.srcId,
      input.rel.slice(0, 32),
      input.dstId,
      input.runId?.slice(0, 80) ?? null,
      typeof input.weight === 'number' ? input.weight : 1
    ],
    env
  )
}

function tokenOverlap(a: string, b: string): number {
  const ta = new Set(normalizeDbQuestionKey(a).match(/[\u4e00-\u9fff]{2,}|[a-z0-9_]{2,}/g) ?? [])
  const tb = new Set(normalizeDbQuestionKey(b).match(/[\u4e00-\u9fff]{2,}|[a-z0-9_]{2,}/g) ?? [])
  if (!ta.size || !tb.size) return 0
  let hit = 0
  for (const t of ta) if (tb.has(t)) hit++
  return hit / Math.max(ta.size, tb.size)
}

export async function upsertKgFromManagerRun(
  input: {
    tenantId?: string
    runId: string
    question: string
    planAgents: string[]
    evidence?: Array<Record<string, unknown>>
    scenarioKey?: string
  },
  env: NodeJS.ProcessEnv = process.env
): Promise<{ entities: number; edges: number }> {
  if (!isKgMemoryEnabled(env) || !isAgentPgConfigured(env)) return { entities: 0, edges: 0 }

  const tenantId = normalizeTenantId(input.tenantId, env)
  const qKey = normalizeDbQuestionKey(input.question)
  if (!qKey) return { entities: 0, edges: 0 }

  let entities = 0
  let edges = 0

  const qId = await upsertEntity(
    {
      tenantId,
      entityType: 'question',
      entityKey: qKey,
      label: input.question.slice(0, 200),
      runId: input.runId
    },
    env
  )
  if (qId) entities += 1

  for (const agent of input.planAgents) {
    const a = String(agent || '').trim().toLowerCase()
    if (!a) continue
    const aId = await upsertEntity(
      { tenantId, entityType: 'agent', entityKey: a, label: a, sourceAgent: a, runId: input.runId },
      env
    )
    if (aId && qId) {
      await upsertEdge({ tenantId, srcId: qId, rel: 'uses_agent', dstId: aId, runId: input.runId }, env)
      edges += 1
      entities += 1
    }
  }

  if (input.scenarioKey) {
    const sId = await upsertEntity(
      {
        tenantId,
        entityType: 'admin_scenario',
        entityKey: input.scenarioKey.slice(0, 120),
        label: input.scenarioKey,
        sourceAgent: 'admin',
        runId: input.runId
      },
      env
    )
    if (sId && qId) {
      await upsertEdge({ tenantId, srcId: qId, rel: 'admin_scenario', dstId: sId, runId: input.runId }, env)
      edges += 1
      entities += 1
    }
  }

  for (const e of input.evidence ?? []) {
    const kind = String(e?.kind ?? '').toLowerCase()
    if (kind === 'db') {
      const tables = Array.isArray(e?.sources) ? e.sources : []
      for (const t of tables) {
        const key = String(t || '').trim()
        if (!key) continue
        const tId = await upsertEntity(
          { tenantId, entityType: 'db_table', entityKey: key, label: key, sourceAgent: 'db', runId: input.runId },
          env
        )
        if (tId && qId) {
          await upsertEdge({ tenantId, srcId: qId, rel: 'queries_table', dstId: tId, runId: input.runId }, env)
          edges += 1
          entities += 1
        }
      }
    }
    if (kind === 'rag') {
      const cites = Array.isArray(e?.citations) ? e.citations : []
      for (const c of cites.slice(0, 6)) {
        const ref = String((c as any)?.source ?? (c as any)?.title ?? '').trim()
        if (!ref) continue
        const rId = await upsertEntity(
          { tenantId, entityType: 'rag_source', entityKey: ref.slice(0, 200), label: ref, sourceAgent: 'rag', runId: input.runId },
          env
        )
        if (rId && qId) {
          await upsertEdge({ tenantId, srcId: qId, rel: 'retrieves', dstId: rId, runId: input.runId }, env)
          edges += 1
          entities += 1
        }
      }
    }
    if (kind === 'code') {
      const files = (e?.hint_files ?? e?.files) as unknown
      const list = Array.isArray(files) ? files : []
      for (const f of list.slice(0, 6)) {
        const key = String(f || '').trim()
        if (!key) continue
        const fId = await upsertEntity(
          { tenantId, entityType: 'code_file', entityKey: key, label: key, sourceAgent: 'code', runId: input.runId },
          env
        )
        if (fId && qId) {
          await upsertEdge({ tenantId, srcId: qId, rel: 'touches_file', dstId: fId, runId: input.runId }, env)
          edges += 1
          entities += 1
        }
      }
    }
    if (kind === 'crawler') {
      const site = String(e?.target_site ?? e?.site ?? '').trim()
      if (site) {
        const cId = await upsertEntity(
          { tenantId, entityType: 'crawl_site', entityKey: site, label: site, sourceAgent: 'crawler', runId: input.runId },
          env
        )
        if (cId && qId) {
          await upsertEdge({ tenantId, srcId: qId, rel: 'crawls', dstId: cId, runId: input.runId }, env)
          edges += 1
          entities += 1
        }
      }
    }
  }

  return { entities, edges }
}

export async function recallKgContextForPlanner(
  question: string,
  opts?: { tenantId?: string; limit?: number },
  env: NodeJS.ProcessEnv = process.env
): Promise<KgEntityRow[]> {
  if (!isKgMemoryEnabled(env) || !isAgentPgConfigured(env)) return []
  const tenantId = normalizeTenantId(opts?.tenantId, env)
  const limit = Math.max(1, Math.min(12, opts?.limit ?? 6))
  const qNorm = normalizeDbQuestionKey(question)

  const res = await agentPgQuery<{
    id: string
    entity_type: string
    entity_key: string
    label: string | null
    source_agent: string | null
  }>(
    `SELECT id, entity_type, entity_key, label, source_agent
     FROM mgr_kg_entities
     WHERE tenant_id = $1 AND entity_type <> 'question'
     ORDER BY updated_at DESC
     LIMIT 80`,
    [tenantId],
    env
  )

  const rows = (res?.rows ?? [])
    .map((r) => ({
      id: Number(r.id),
      entityType: r.entity_type,
      entityKey: r.entity_key,
      label: String(r.label || r.entity_key),
      sourceAgent: r.source_agent ?? undefined,
      score: tokenOverlap(question, r.label || r.entity_key)
    }))
    .filter((r) => r.score > 0.15 || r.entityKey.includes(qNorm.slice(0, 20)))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)

  return rows.map(({ id, entityType, entityKey, label, sourceAgent }) => ({
    id,
    entityType,
    entityKey,
    label,
    sourceAgent
  }))
}

export function formatKgBlockForPlanner(rows: KgEntityRow[]): string {
  if (!rows.length) return ''
  const lines = rows.map((r) => `- ${r.entityType}:${r.entityKey}${r.sourceAgent ? `（${r.sourceAgent}）` : ''}`)
  return ['### 知识图谱召回（跨 Agent 实体关系）', ...lines].join('\n')
}
