import { inferDbFieldConstraintsStructural, inferDbFieldHintsStructural } from '#agent-shared/managerDbFieldConstraints'
import type { TaskConstraints } from '../../graph/core/plan'
import { EMPTY_TASK_CONSTRAINTS, taskConstraintsFromMeta } from '../../graph/llm/taskConstraintsLlm'
import type { DbProbeHints } from './managerDbHintsLlm'
import { dbProbeHintsFromMeta, inferDbProbeHintsStructural } from './managerDbHintsLlm'
import { enrichManagerDbTaskFromPrefetch } from './managerDbPrefetchReuse'
import { pickRichestDbQuestion } from './managerDbQuestionLlm'
import { lastUserText } from '../../graph/core/text'
import { dbQueryFocusFromMeta } from '../../graph/core/db/dbStepQuestion'
import { resolveSubAgentTurnScope, resolveTurnScopeFromMeta } from '../../graph/core/runtime/sessionBridge'
import { shouldOmitManagerDbSchemaHints } from './managerDbSchemaHintsPolicy'
import type { BaseMessage } from '@langchain/core/messages'
import type { TurnScopePayload } from '#agent-shared/turnScope'
import type { DbExecutionShapeHint } from './managerDbExecutionShapeHint'
import { executionShapeHintFromQueryPlanJson } from './managerDbExecutionShapeHint'

/** 总管→DB 上游上下文分隔符（exec 注入上游事实块）；refined_question 不得含此后缀 */
export const MANAGER_CTX_SEP = '\n\n已知信息（来自上游步骤，仅供事实参考）：\n'

export function stripManagerContextSep(text: string): string {
  const parts = String(text ?? '').split(MANAGER_CTX_SEP)
  return String(parts[0] ?? '').replace(/\s+/g, ' ').trim()
}

/** 与 DB_Agent 接受的 managerTask / manager_task_json 字段对齐 */
export type ManagerDbTaskPayload = {
  source: 'manager'
  refined_question: string
  must_filters: string[]
  schema_search_keywords: string
  sql_intent_summary?: string
  risk_notes?: string[]
  hint_tables?: string[]
  hint_fields?: string[]
  schema_fk_hints?: string[]
  /** /api/plan 预取的 query plan JSON，DB 内可跳过 plan LLM */
  query_plan_json?: string
  /** 总管 prefetch 后 DB 复用 schema 接地，跳过向量探表 */
  prefetch_reuse?: boolean
  /** SchemaGroundResult JSON，来自 prefetch /api/plan */
  prefetch_schema_ground_json?: string
  /** 编排/prefetch 推断的执行形态，DB resolveQueryExecutionShape 优先信任 */
  execution_shape_hint?: DbExecutionShapeHint
  turn_scope?: TurnScopePayload
}

/**
 * 仅从问句与路由约束词拼接 schema 检索词；不做中文滑窗分词。
 * 拆词会把「压力」等 token 单独送入 DB schema 检索，抬高扩展从表列注释得分。
 */
function joinSchemaSearchKeywords(questionForDb: string, extraTokens: string[]): string {
  const q = String(questionForDb ?? '').replace(/\s+/g, ' ').trim()
  const parts: string[] = []
  const seen = new Set<string>()
  const push = (s: string) => {
    const t = String(s ?? '').trim()
    if (t.length < 2 || seen.has(t)) return
    seen.add(t)
    parts.push(t)
  }
  push(q)
  for (const x of extraTokens) {
    const t = String(x ?? '').trim()
    if (t.length < 2 || q.includes(t)) continue
    push(t)
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 220) || q.slice(0, 220)
}

function resolveHintTables(
  probe?: { db?: { tables?: string[]; matched?: boolean } } | null,
  dbHints?: DbProbeHints | null
): string[] {
  if (dbHints?.hintTables?.length) return dbHints.hintTables.slice(0, 4)
  const structural = inferDbProbeHintsStructural(probe)
  return structural?.hintTables?.length ? structural.hintTables.slice(0, 4) : []
}

/**
 * 总管 → DB 的可选载荷：硬约束、probe 表提示（由 plan 阶段 LLM/结构性启发写入 meta.dbProbeHints）。
 * 若与直连一致（无约束、无表线索、无额外检索词），返回 null，不传 managerTask，避免空「总管约束」块干扰 SQL。
 */
export function buildManagerDbTaskPayload(
  questionForDb: string,
  probe?: { db?: { tables?: string[]; matched?: boolean } } | null,
  constraints?: TaskConstraints | null,
  dbHints?: DbProbeHints | null,
  opts?: { omitSchemaHints?: boolean }
): ManagerDbTaskPayload | null {
  const q = stripManagerContextSep(String(questionForDb ?? ''))
  const c = constraints ?? { ...EMPTY_TASK_CONSTRAINTS }
  const hints = dbHints ?? null
  const must: string[] = []
  const qLower = q.toLowerCase()
  const inQuestion = (token: string) => {
    const t = String(token ?? '').trim()
    return t.length >= 2 && (q.includes(t) || qLower.includes(t.toLowerCase()))
  }
  const timeInQ = c.timeHints.filter(inQuestion)
  const subjectInQ = c.subjectHints.filter(inQuestion)
  if (timeInQ.length) must.push(`时间口径须包含：${timeInQ.join('、')}`)
  if (subjectInQ.length) must.push(`对象/实体须覆盖：${subjectInQ.join('、')}`)
  const fieldConstraints = inferDbFieldConstraintsStructural({ constraints: c })
  if (subjectInQ.length || timeInQ.length) {
    for (const m of fieldConstraints.mustFilters) {
      if (!must.includes(m)) must.push(m)
    }
  }
  const fieldHints = inferDbFieldHintsStructural({ constraints: c }).filter(inQuestion)
  const extraForBroaden = [...fieldHints, ...subjectInQ, ...timeInQ]
  const omitSchemaHints = Boolean(opts?.omitSchemaHints)
  const tables = omitSchemaHints ? [] : resolveHintTables(probe, hints)
  const fkHints = omitSchemaHints ? '' : String(hints?.schemaFkHints ?? '').trim()
  const schema_search_keywords = (() => {
    const joined = joinSchemaSearchKeywords(q, extraForBroaden)
    if (!must.length && !tables.length && joined.replace(/\s+/g, '') === q.replace(/\s+/g, '')) return ''
    return joined
  })()
  const risk_notes: string[] = [...(hints?.riskNotes ?? []), ...fieldConstraints.riskNotes]
  if (!omitSchemaHints && tables.length && !risk_notes.some((r) => r.includes('probe'))) {
    risk_notes.push(`数据库侧 probe 曾关联表名（仅供参考）：${tables.join('、')}`)
  }

  const hint_tables = tables.length ? tables : undefined
  const hint_fields = fieldHints.length ? fieldHints : undefined
  const schema_fk_hints = fkHints || undefined
  const sql_intent_summary =
    must.length > 0
      ? '总管已合并路由约束与字段完整性要求；请在只读 SELECT 中落实 JOIN、业务列与上述时间与对象条件。'
      : undefined

  if (
    !must.length &&
    !hint_tables?.length &&
    !hint_fields?.length &&
    !schema_fk_hints &&
    !risk_notes.length &&
    !sql_intent_summary &&
    !String(schema_search_keywords || '').trim()
  ) {
    return null
  }

  return {
    source: 'manager',
    refined_question: q,
    must_filters: must,
    schema_search_keywords,
    sql_intent_summary,
    risk_notes: risk_notes.length ? risk_notes : undefined,
    hint_tables,
    hint_fields,
    schema_fk_hints
  }
}

function schemaFkHintsFromState(meta: unknown): string | undefined {
  const prefetch = (meta as { dbPlanPrefetch?: { unified_task_plan?: { hints?: Record<string, unknown> } } } | null)
    ?.dbPlanPrefetch
  const hints = prefetch?.unified_task_plan?.hints
  const fk = String(hints?.schema_fk_hints ?? '').trim()
  return fk || undefined
}

function attachTurnScope(
  payload: ManagerDbTaskPayload | null,
  meta: unknown,
  fallbackQuestion?: string
): ManagerDbTaskPayload | null {
  const turn_scope = resolveSubAgentTurnScope(meta) ?? resolveTurnScopeFromMeta(meta)
  if (!turn_scope) return payload
  if (payload) return { ...payload, turn_scope }
  const q = String(fallbackQuestion ?? '').trim()
  if (!q) return { source: 'manager', refined_question: '', must_filters: [], schema_search_keywords: '', turn_scope }
  return {
    source: 'manager',
    refined_question: q,
    must_filters: [],
    schema_search_keywords: '',
    turn_scope
  }
}

/** 从 graph state 构建 DB managerTask（exec / fix 节点用） */
export function buildManagerDbTaskPayloadFromState(
  questionForDb: string,
  state: {
    probe?: { db?: { tables?: string[]; matched?: boolean } } | null
    meta?: unknown
    messages?: BaseMessage[]
  }
): ManagerDbTaskPayload | null {
  const lastUser = state.messages?.length ? lastUserText(state.messages) : ''
  const orchestratedFocus = dbQueryFocusFromMeta(state.meta, questionForDb)
  const scopedQuestion = stripManagerContextSep(
    orchestratedFocus.length >= 4 ? orchestratedFocus : String(questionForDb ?? '').trim()
  )
  const richest = pickRichestDbQuestion(scopedQuestion, lastUser, undefined, { meta: state.meta })
  const omitSchemaHints = shouldOmitManagerDbSchemaHints({
    question: richest,
    lastUser,
    meta: state.meta,
    intent: (state as { intent?: string }).intent
  })
  if (omitSchemaHints) {
    return attachTurnScope(
      {
        source: 'manager',
        refined_question: richest,
        must_filters: [],
        schema_search_keywords: ''
      },
      state.meta,
      richest
    )
  }
  const probeHints = dbProbeHintsFromMeta(state.meta) ?? { hintTables: [], riskNotes: [] }
  const fk = schemaFkHintsFromState(state.meta)
  const mergedHints = fk ? { ...probeHints, schemaFkHints: fk } : probeHints
  const base = buildManagerDbTaskPayload(
    richest,
    state.probe,
    taskConstraintsFromMeta(state.meta),
    mergedHints,
    { omitSchemaHints: false }
  )
  return attachTurnScope(enrichManagerDbTaskFromPrefetch(base, state.meta, { omitSchemaHints: false }), state.meta, richest)
}
