import { z } from 'zod'
import { safeJsonParse } from '../../graph/core/shared/llmJson'
import type { LlmInvokeFn } from '../../graph/llm/taskConstraintsLlm'

const AlignSchema = z.object({
  aligned: z.boolean(),
  db_question: z.string().min(2).max(900),
  confidence: z.number().min(0).max(1).optional(),
  rationale: z.string().optional()
})

export type DbPrefetchAlignResult = {
  aligned: boolean
  dbQuestion: string
  confidence: number
  rationale?: string
}

function normalizeQ(s: string): string {
  return String(s ?? '')
    .replace(/\s+/g, '')
    .trim()
    .toLowerCase()
}

function normalizeDbAlignText(s: string): string {
  return normalizeQ(s).replace(/的/g, '').replace(/数据库查/g, '查')
}

function structuralAlign(
  prefetchQ: string,
  execQ: string,
  userTask?: string
): DbPrefetchAlignResult | null {
  const p = normalizeDbAlignText(prefetchQ)
  const e = normalizeDbAlignText(execQ)
  if (!p || !e) return null
  if (p === e) {
    return { aligned: true, dbQuestion: execQ, confidence: 0.95, rationale: 'exact_match' }
  }
  if (e.includes(p) || p.includes(e)) {
    const ratio = Math.min(p.length, e.length) / Math.max(p.length, e.length)
    if (ratio >= 0.45) {
      return { aligned: true, dbQuestion: execQ, confidence: 0.82, rationale: 'substring_overlap' }
    }
  }
  const u = normalizeQ(String(userTask || ''))
  if (u && p.length >= 8 && e.length >= 8) {
    const bothScoped = p.length <= u.length * 0.92 && e.length <= u.length * 0.92
    const pInUser = u.includes(p)
    const eInUser = u.includes(e)
    if (bothScoped && pInUser && eInUser && (e.includes(p) || p.includes(e))) {
      return {
        aligned: true,
        dbQuestion: execQ,
        confidence: 0.9,
        rationale: 'scoped_db_subtask_match'
      }
    }
    if (pInUser && p.length <= u.length * 0.92 && (p === e || e.includes(p) || p.includes(e))) {
      return {
        aligned: true,
        dbQuestion: execQ,
        confidence: 0.88,
        rationale: 'scoped_db_subtask_match'
      }
    }
  }
  return null
}

export function isDbPrefetchAlignLlmEnabled(): boolean {
  return String(process.env.MANAGER_DB_PREFETCH_ALIGN_LLM ?? '1').trim() !== '0'
}

/**
 * 判断 prefetch /api/plan 是否可用于当前 DB 执行问句。
 * 复合任务预取基于错误整句时 aligned=false，DB 侧重新 schema 接地。
 */
export async function judgeDbPrefetchAlignment(input: {
  prefetchQuestion: string
  execQuestion: string
  userTask: string
  suggestedTables?: string[]
  llmInvoke?: LlmInvokeFn | null
  state?: unknown
}): Promise<DbPrefetchAlignResult> {
  const prefetchQ = String(input.prefetchQuestion ?? '').trim()
  const execQ = String(input.execQuestion ?? '').trim()
  const userTask = String(input.userTask ?? '').trim()

  if (!prefetchQ) {
    return { aligned: false, dbQuestion: execQ || userTask, confidence: 0, rationale: 'no_prefetch_question' }
  }
  if (!execQ) {
    return { aligned: false, dbQuestion: userTask, confidence: 0, rationale: 'empty_exec_question' }
  }

  const structural = structuralAlign(prefetchQ, execQ, userTask)
  if (structural) return structural

  if (!isDbPrefetchAlignLlmEnabled() || !input.llmInvoke) {
    return { aligned: false, dbQuestion: execQ, confidence: 0.35, rationale: 'structural_mismatch' }
  }

  const tables = (input.suggestedTables ?? []).slice(0, 6).join('、')
  try {
    const r = await input.llmInvoke('plan', input.state, [
      [
        'system',
        [
          '你是数据库预取对齐判定器。判断「预取问句」与「当前 DB 执行问句」是否指向同一查数任务。',
          '只输出 JSON，禁止 markdown。',
          '规则：',
          '- 复合任务中预取若基于整句（含知识库/报告/图表/办公），而执行问句仅为 DB 子句 → aligned=false。',
          '- 若预取问句与执行问句均为同一 DB 子任务（均为用户原话的真子集且语义一致）→ aligned=true。',
          '- 仅当两问句的查数对象、指标、过滤条件语义一致时 aligned=true。',
          '- db_question 输出应交给 DB Agent 的最终自然语言问句（优先 exec_question，可合并 user_task 中明确的 DB 条件）。',
          '- 禁止编造表名或未提及过滤条件。',
          'schema: {"aligned":bool,"db_question":string,"confidence":0-1,"rationale":string}'
        ].join('\n')
      ],
      [
        'human',
        [
          userTask ? `用户原话：${userTask.slice(0, 800)}` : '',
          `预取问句：${prefetchQ.slice(0, 600)}`,
          `执行问句：${execQ.slice(0, 600)}`,
          tables ? `预取建议表：${tables}` : ''
        ]
          .filter(Boolean)
          .join('\n\n')
      ]
    ], { tier: 'light' })
    const parsed = AlignSchema.safeParse(safeJsonParse(String(r.text ?? '').trim()))
    if (!parsed.success || Number(parsed.data.confidence ?? 0) < 0.52) {
      return { aligned: false, dbQuestion: execQ, confidence: 0.4, rationale: 'llm_low_confidence' }
    }
    const q = String(parsed.data.db_question ?? execQ).trim()
    return {
      aligned: parsed.data.aligned === true,
      dbQuestion: q.length >= 2 ? q.slice(0, 900) : execQ,
      confidence: Number(parsed.data.confidence ?? 0.65),
      rationale: String(parsed.data.rationale ?? '').slice(0, 240) || undefined
    }
  } catch {
    return { aligned: false, dbQuestion: execQ, confidence: 0.3, rationale: 'llm_error' }
  }
}
