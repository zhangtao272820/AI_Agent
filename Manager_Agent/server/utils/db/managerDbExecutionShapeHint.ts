/** 与 DB_Agent dbQueryExecutionShapeLlm.QueryExecutionShape 对齐 */
export type DbExecutionShapeHint =
  | 'scalar_lookup'
  | 'distribution'
  | 'trend'
  | 'detail_rows'
  | 'comparison'
  | 'freeform_sql'

const SHAPES = new Set<string>([
  'scalar_lookup',
  'distribution',
  'trend',
  'detail_rows',
  'comparison',
  'freeform_sql'
])

/** 从 prefetch / 编排 query_plan JSON 结构性映射 execution_shape（不读用户问句 regex） */
export function executionShapeHintFromQueryPlanJson(raw?: string): DbExecutionShapeHint | undefined {
  const s = String(raw ?? '').trim()
  if (!s || s.length < 8) return undefined
  try {
    const p = JSON.parse(s) as {
      intent?: string
      metrics?: string[]
      dimensions?: string[]
    }
    const intent = String(p.intent || '').trim()
    const hasMetrics = (p.metrics?.length ?? 0) > 0
    const hasDims = (p.dimensions?.length ?? 0) > 0
    if (intent === 'trend') return 'trend'
    if (intent === 'comparison') return 'comparison'
    // 有分组维度时优先 distribution；避免误标 detail 却带着「性别」等维度去拉明细列表
    if (hasDims) return 'distribution'
    if (intent === 'detail') return 'detail_rows'
    if (intent === 'schema_help') return 'freeform_sql'
    if (hasMetrics || intent === 'aggregation') return 'scalar_lookup'
    return undefined
  } catch {
    return undefined
  }
}

export function coerceDbExecutionShapeHint(raw: unknown): DbExecutionShapeHint | undefined {
  const s = String(raw ?? '').trim()
  return SHAPES.has(s) ? (s as DbExecutionShapeHint) : undefined
}

/** prefetch schema ground：primary 之外的候选表写入 auxiliary_tables */
export function auxiliaryTablesFromCandidates(tables: string[], primary: string[]): string[] {
  const primarySet = new Set(primary.filter(Boolean))
  return tables.filter((t) => t && !primarySet.has(t))
}
