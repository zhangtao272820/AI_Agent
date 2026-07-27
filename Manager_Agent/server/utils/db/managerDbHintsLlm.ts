import { z } from 'zod'
import { safeJsonParse } from '../../graph/core/shared/llmJson'
import type { LlmInvokeFn } from '../../graph/llm/taskConstraintsLlm'

export type DbProbeHints = {
  hintTables: string[]
  riskNotes: string[]
  schemaFkHints?: string
  rationale?: string
  confidence?: number
}

export const EMPTY_DB_PROBE_HINTS: DbProbeHints = {
  hintTables: [],
  riskNotes: []
}

const DbProbeHintsSchema = z.object({
  hint_tables: z.array(z.string()).max(4).default([]),
  risk_notes: z.array(z.string()).max(4).default([]),
  rationale: z.string().optional(),
  confidence: z.number().min(0).max(1).optional()
})

export function dbProbeHintsFromMeta(meta: unknown): DbProbeHints | null {
  const h = (meta as { dbProbeHints?: DbProbeHints } | null)?.dbProbeHints
  if (!h || typeof h !== 'object') return null
  return {
    hintTables: Array.isArray(h.hintTables) ? h.hintTables.map(String).filter(Boolean).slice(0, 4) : [],
    riskNotes: Array.isArray(h.riskNotes) ? h.riskNotes.map(String).filter(Boolean).slice(0, 4) : [],
    rationale: h.rationale ? String(h.rationale) : undefined,
    confidence: typeof h.confidence === 'number' ? h.confidence : undefined
  }
}

export function isDbProbeHintsLlmEnabled(): boolean {
  return String(process.env.MANAGER_DB_PROBE_HINTS_LLM ?? '0').trim() !== '0'
}

function probeTableList(probe?: { db?: { tables?: string[]; matched?: boolean } } | null): string[] {
  if (!probe?.db?.matched) return []
  return Array.isArray(probe.db.tables)
    ? probe.db.tables.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 8)
    : []
}

function normalizeDbProbeHints(raw: DbProbeHints, allowedTables: string[]): DbProbeHints {
  const allowed = new Set(allowedTables.map((t) => t.toLowerCase()))
  const hintTables = raw.hintTables
    .map((t) => String(t ?? '').trim())
    .filter((t) => t && allowed.has(t.toLowerCase()))
    .slice(0, 4)
  const riskNotes = raw.riskNotes.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 4)
  return {
    hintTables,
    riskNotes,
    rationale: raw.rationale ? String(raw.rationale).slice(0, 320) : undefined,
    confidence: raw.confidence
  }
}

/**
 * 结构性推断：probe 仅命中单表时直接采用，无需 LLM。
 */
export function inferDbProbeHintsStructural(
  probe?: { db?: { tables?: string[]; matched?: boolean } } | null
): DbProbeHints | null {
  const tables = probeTableList(probe)
  if (!tables.length) {
    return { ...EMPTY_DB_PROBE_HINTS, confidence: 1, rationale: 'probe 未命中表' }
  }
  if (tables.length === 1) {
    return {
      hintTables: [tables[0]!],
      riskNotes: [],
      confidence: 0.92,
      rationale: 'probe 仅命中单表'
    }
  }
  if (tables.length >= 2) {
    return {
      hintTables: tables.slice(0, 2),
      riskNotes: [],
      confidence: 0.85,
      rationale: 'probe 多表快路径（按相关度取前表，免 LLM）'
    }
  }
  return null
}

/**
 * 用 LLM 在 probe 多表候选中区分主记录表与扩展从表，避免 hint 拉偏 SQL。
 */
export async function extractDbProbeHintsByLlm(input: {
  question: string
  probe?: { db?: { tables?: string[]; matched?: boolean; evidence?: string } } | null
  llmInvoke: LlmInvokeFn
  state: unknown
}): Promise<DbProbeHints> {
  const q = String(input.question ?? '').trim()
  const tables = probeTableList(input.probe)
  if (!q || tables.length < 2) return inferDbProbeHintsStructural(input.probe) ?? { ...EMPTY_DB_PROBE_HINTS }

  const evidence = String((input.probe?.db as { evidence?: string } | undefined)?.evidence ?? '').trim()

  try {
    const r = await input.llmInvoke('plan', input.state, [
      [
        'system',
        [
          '你是数据库 schema 选表启发器。根据用户问题语义，在 probe 给出的候选表名中选择应作为 SQL 主查表的 hint。',
          '只输出 JSON，禁止 markdown。',
          '',
          '判断原则（按语义，禁止关键词表/正则硬匹配）：',
          '- 用户问测试/检测/记录/报告/明细时，优先主记录表；扩展/区域/分区/坐标类从表仅当问题明确需要该维度时才 hint 或写入 risk_notes 说明可 JOIN。',
          '- hint_tables 必须是候选表名的子集，最多 3 个；不要把所有候选表都塞进去。',
          '- 若主从表同时出现，默认只 hint 主记录表，并在 risk_notes 说明从表用途与何时才 JOIN。',
          '- 候选表名以外不得编造表名。',
          '',
          'schema: {"hint_tables":string[],"risk_notes":string[],"rationale":string,"confidence":number}'
        ].join('\n')
      ],
      [
        'human',
        [
          `用户问题：${q.slice(0, 1200)}`,
          `probe 候选表：${tables.join('、')}`,
          evidence ? `probe 检索摘要（仅供参考）：\n${evidence.slice(0, 900)}` : ''
        ]
          .filter(Boolean)
          .join('\n\n')
      ]
    ])
    const parsed = DbProbeHintsSchema.safeParse(safeJsonParse(String(r.text ?? '').trim()))
    if (!parsed.success) return { ...EMPTY_DB_PROBE_HINTS }
    const conf = Number(parsed.data.confidence ?? 0)
    if (conf < 0.4) return { ...EMPTY_DB_PROBE_HINTS }
    return normalizeDbProbeHints(
      {
        hintTables: parsed.data.hint_tables,
        riskNotes: parsed.data.risk_notes,
        rationale: parsed.data.rationale,
        confidence: conf
      },
      tables
    )
  } catch {
    return { ...EMPTY_DB_PROBE_HINTS }
  }
}

/** 先结构性推断，probe 多表时再调 LLM（MANAGER_DB_PROBE_HINTS_LLM=0 可关） */
export async function resolveDbProbeHints(input: {
  question: string
  probe?: { db?: { tables?: string[]; matched?: boolean; evidence?: string } } | null
  llmInvoke: LlmInvokeFn
  state: unknown
}): Promise<DbProbeHints> {
  const structural = inferDbProbeHintsStructural(input.probe)
  if (structural && probeTableList(input.probe).length <= 1) return structural
  if (!isDbProbeHintsLlmEnabled()) return structural ?? { ...EMPTY_DB_PROBE_HINTS }
  const llm = await extractDbProbeHintsByLlm(input)
  if (Number(llm.confidence ?? 0) >= 0.4 && (llm.hintTables.length || llm.riskNotes.length)) return llm
  return structural ?? { ...EMPTY_DB_PROBE_HINTS }
}

/** plan 阶段：优先 meta 缓存，否则解析并供 exec 使用 */
export async function ensureDbProbeHintsForPlan(input: {
  state: { meta?: unknown; probe?: { db?: { tables?: string[]; matched?: boolean } } | null }
  question: string
  llmInvoke: LlmInvokeFn
  willUseDb: boolean
}): Promise<DbProbeHints> {
  const cached = dbProbeHintsFromMeta(input.state.meta)
  if (cached) return cached
  if (!input.willUseDb || !input.state.probe?.db?.matched) return { ...EMPTY_DB_PROBE_HINTS }
  return resolveDbProbeHints({
    question: input.question,
    probe: input.state.probe,
    llmInvoke: input.llmInvoke,
    state: input.state
  })
}
