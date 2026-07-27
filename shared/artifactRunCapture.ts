/**
 * P0：从 Manager graph state 捕获 run 级产物摘要
 */
import type { FeedbackArtifact } from './artifactFeedbackPolicy'
import { hashSql } from './artifactStore'
import { normalizeDbQuestionKey } from './dbExperienceBridge'

function normAgents(planAgents: string[]): string[] {
  return planAgents.map((a) => String(a || '').trim().toLowerCase()).filter(Boolean)
}

function extractDbSqlFromState(state: Record<string, unknown>): string {
  const evidence = Array.isArray(state.evidence) ? state.evidence : []
  for (const e of evidence) {
    if (String((e as any)?.kind ?? '') !== 'db') continue
    const sql = String((e as any)?.sql ?? (e as any)?.executed_sql ?? '').trim()
    if (sql) return sql
    const structured = (e as any)?.meta?.agentResult?.structured
    if (structured?.executed_sql) return String(structured.executed_sql).trim()
  }
  const meta = state.meta as Record<string, unknown> | undefined
  const agentResults = meta?.agentResults as Record<string, unknown> | undefined
  const dbMeta = agentResults?.db as Record<string, unknown> | undefined
  if (dbMeta?.structured && typeof dbMeta.structured === 'object') {
    const sql = String((dbMeta.structured as any).executed_sql ?? '').trim()
    if (sql) return sql
  }
  return ''
}

function extractRagSourcesFromState(state: Record<string, unknown>): { sources: string[]; chunkIds: string[] } {
  const probe = state.probe as Record<string, unknown> | undefined
  const ragProbe = probe?.rag as Record<string, unknown> | undefined
  const sources = Array.isArray(ragProbe?.sources) ? ragProbe!.sources!.map(String).filter(Boolean) : []
  const chunkIds = Array.isArray(ragProbe?.chunk_ids)
    ? ragProbe!.chunk_ids!.map(String).filter(Boolean)
    : []
  if (sources.length) return { sources: sources.slice(0, 8), chunkIds: chunkIds.slice(0, 12) }
  const evidence = Array.isArray(state.evidence) ? state.evidence : []
  for (const e of evidence) {
    if (String((e as any)?.kind ?? '') !== 'rag') continue
    const evSources = Array.isArray((e as any)?.sources) ? (e as any).sources.map(String).filter(Boolean) : []
    if (evSources.length) return { sources: evSources.slice(0, 8), chunkIds: [] }
  }
  return { sources: [], chunkIds: [] }
}

function inferAdminTools(state: Record<string, unknown>, planAgents: string[]): string[] {
  if (!planAgents.includes('admin')) return []
  const intent = String(state.intent || '').trim()
  const scenarioKey = String((state.meta as any)?.scenarioKey || intent || 'admin').slice(0, 64)
  return [scenarioKey]
}

export function captureRunArtifactsFromState(
  state: Record<string, unknown>,
  planAgents: string[],
  question: string
): {
  toolChain: string[]
  subArtifacts: Record<string, FeedbackArtifact>
  managerArtifact: FeedbackArtifact
} {
  const chain = normAgents(planAgents)
  const subArtifacts: Record<string, FeedbackArtifact> = {}
  const questionNorm = normalizeDbQuestionKey(question)

  if (chain.includes('db')) {
    const sql = extractDbSqlFromState(state)
    subArtifacts.db = {
      kind: 'db_sql',
      ...(sql ? { sql_hash: hashSql(sql) } : {}),
      tool_chain: ['db']
    }
    void questionNorm
  }

  if (chain.includes('rag')) {
    const { sources, chunkIds } = extractRagSourcesFromState(state)
    subArtifacts.rag = {
      kind: 'rag_retrieval',
      source_labels: sources,
      chunk_ids: chunkIds,
      tool_chain: ['rag']
    }
  }

  if (chain.includes('admin')) {
    const tools = inferAdminTools(state, chain)
    subArtifacts.admin = {
      kind: 'admin_tool',
      tools,
      tool_chain: ['admin']
    }
  }

  return {
    toolChain: chain,
    subArtifacts,
    managerArtifact: { kind: 'manager_plan', tool_chain: chain }
  }
}

export function mergeFeedbackArtifact(
  base: FeedbackArtifact | null | undefined,
  override: FeedbackArtifact | null | undefined
): FeedbackArtifact | null {
  if (!base && !override) return null
  return { ...(base ?? {}), ...(override ?? {}) }
}
