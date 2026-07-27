/**
 * Probe 结果解读：区分「业务库表命中」与「RAG/向量库元数据表命中」。
 * dify_knowledge_doc* 等是知识库后端存储，不得作为 db Agent 路由依据。
 */

export type ProbeDbSlice = {
  matched?: boolean
  tables?: string[]
  schemaMatched?: boolean
  executable?: boolean
}

/** 表名是否属于 RAG/知识库基础设施（非用户要查的业务库表） */
export function isRagInfrastructureTableName(table: string): boolean {
  const t = String(table ?? '').trim().toLowerCase()
  if (!t) return false
  if (t.includes('dify_knowledge') || t.includes('knowledge_doc')) return true
  if (t.includes('vector_store') || t.includes('embedding') || t.includes('doc_segment')) return true
  if (t.startsWith('rag_') && (t.includes('doc') || t.includes('chunk') || t.includes('segment'))) return true
  return false
}

/** DB probe 是否应对路由/预取生效（业务库表，非 RAG 元数据） */
export function isProbeDbRoutingRelevant(db?: ProbeDbSlice | null): boolean {
  if (!db) return false
  const tables = (Array.isArray(db.tables) ? db.tables : []).map((s) => String(s ?? '').trim()).filter(Boolean)
  if (!tables.length) return Boolean(db.matched && db.executable !== false)
  const business = tables.filter((t) => !isRagInfrastructureTableName(t))
  return business.length > 0
}

export function interpretProbeDbForRouting(db?: ProbeDbSlice | null): {
  routingRelevant: boolean
  ragInfraOnly: boolean
  businessTables: string[]
  infraTables: string[]
} {
  const tables = (Array.isArray(db?.tables) ? db!.tables! : []).map((s) => String(s ?? '').trim()).filter(Boolean)
  const infraTables = tables.filter(isRagInfrastructureTableName)
  const businessTables = tables.filter((t) => !isRagInfrastructureTableName(t))
  const ragInfraOnly = tables.length > 0 && businessTables.length === 0
  const routingRelevant = isProbeDbRoutingRelevant(db)
  return { routingRelevant, ragInfraOnly, businessTables, infraTables }
}

export function formatProbeForOrchestrator(probe?: {
  db?: ProbeDbSlice
  rag?: { hits?: number; hasDocs?: boolean }
} | null): string {
  const ragHits = Number(probe?.rag?.hits ?? 0)
  const dbInterp = interpretProbeDbForRouting(probe?.db)
  const lines = [
    '【探测说明】仅表示服务可达；RAG 元数据表命中 ≠ 用户要查业务库',
    `RAG 可达: ${ragHits > 0 ? `${ragHits} hits` : 'no hit'}`
  ]
  if (dbInterp.ragInfraOnly) {
    lines.push(
      `DB schema 命中 RAG 元数据表（${dbInterp.infraTables.slice(0, 3).join(',')}），routingRelevant=false，禁止因此加 db Agent`
    )
  } else if (dbInterp.routingRelevant) {
    lines.push(`DB 业务表命中: ${dbInterp.businessTables.slice(0, 3).join(',') || 'yes'}`)
  } else {
    lines.push('DB 业务表: 未命中')
  }
  return lines.join('\n')
}
