/**
 * @deprecated 请使用 managerCodeAuthorityLlm.ts（enrichCodeOutputByLlm / planChartFromCodeByLlm）。
 */
import { z } from 'zod'
import { ChatOpenAI } from '@langchain/openai'
import { safeJsonParse } from '../../graph/core/shared/llmJson'
import type { FinanceTriplet } from '#agent-shared/financeChartSchema'
import { CODE_MONTHLY_FINANCE_SCHEMA_RULE, type CodeFinanceConsistencyResult } from '#agent-shared/financeChartSchema'

const FinanceContextSchema = z.object({
  is_finance: z.boolean(),
  is_social_insurance_key: z.boolean().optional(),
  confidence: z.number().min(0).max(1).optional()
})

const FactRoleSchema = z.object({
  role: z.enum(['income', 'expense', 'balance', 'deduction', 'ratio', 'metric', 'other']),
  confidence: z.number().min(0).max(1).optional()
})

const FactRolesBatchSchema = z.object({
  items: z.array(
    z.object({
      key: z.string(),
      role: z.enum(['income', 'expense', 'balance', 'deduction', 'ratio', 'metric', 'other'])
    })
  ),
  confidence: z.number().min(0).max(1).optional()
})

const CodeNormalizeSchema = z.object({
  should_normalize: z.boolean(),
  monthly_finance: z
    .object({
      income_yuan: z.number(),
      expense_yuan: z.number(),
      balance_yuan: z.number()
    })
    .optional(),
  aligned_answer: z.string().optional(),
  auxiliary_facts: z.array(z.object({ key: z.string(), value: z.union([z.string(), z.number()]) })).optional(),
  confidence: z.number().min(0).max(1).optional()
})

const ConsistencySchema = z.object({
  pass: z.boolean(),
  reason: z.string().optional(),
  retry_intent: z.enum(['code', 'visualize']).optional(),
  synth_only: z.boolean().optional(),
  confidence: z.number().min(0).max(1).optional()
})

const FINANCE_MARKERS = [
  'monthly_finance',
  '月收入',
  '月支出',
  '月结余',
  'income_yuan',
  'expense_yuan',
  'balance_yuan',
  '收入',
  '支出',
  '结余',
  'income',
  'expense',
  'balance',
  'ratio',
  '占比'
] as const

const SOCIAL_INSURANCE_MARKERS = ['公积金', '五险', '社保'] as const

export type FactRole = z.infer<typeof FactRoleSchema>['role']

export function isCodeFinanceLlmEnabled(): boolean {
  return String(process.env.MANAGER_CODE_FINANCE_LLM ?? '1').trim() !== '0'
}

function normKey(k: string): string {
  return String(k ?? '')
    .trim()
    .toLowerCase()
    .split('')
    .filter((ch) => ch !== ' ' && ch !== '\t')
    .join('')
}

function containsMarker(text: string, markers: readonly string[]): boolean {
  const t = String(text ?? '').toLowerCase()
  for (const m of markers) {
    if (t.includes(m.toLowerCase())) return true
  }
  return false
}

export function isFinanceFactKeyStructural(key: string): boolean {
  return containsMarker(key, FINANCE_MARKERS)
}

export function isSocialInsuranceKeyStructural(key: string): boolean {
  return containsMarker(key, SOCIAL_INSURANCE_MARKERS)
}

export function upstreamLooksFinanceStructural(upstream: string): boolean {
  return containsMarker(upstream, FINANCE_MARKERS)
}

export function resolveFinanceFactKey(key: string): { finance: boolean; social: boolean } {
  return {
    finance: isFinanceFactKeyStructural(key),
    social: isSocialInsuranceKeyStructural(key)
  }
}

export function createFinanceLlmModel(input: {
  openaiApiKey?: string
  openaiBaseUrl?: string
  modelName?: string
}): ChatOpenAI | null {
  const apiKey = String(input.openaiApiKey ?? process.env.OPENAI_API_KEY ?? '').trim()
  if (!apiKey) return null
  const model =
    String(input.modelName ?? process.env.MANAGER_MODEL_LOW_COST ?? process.env.MANAGER_MODEL_ROUTE ?? 'qwen-flash-2025-07-28').trim()
  const baseURL = String(input.openaiBaseUrl ?? process.env.OPENAI_BASE_URL ?? '').trim() || undefined
  return new ChatOpenAI({
    apiKey,
    configuration: baseURL ? { baseURL } : undefined,
    model,
    temperature: 0
  })
}

export async function classifyFinanceContextByLlm(
  model: ChatOpenAI | null,
  text: string
): Promise<{ isFinance: boolean; isSocialInsuranceKey: boolean } | null> {
  if (!model) return null
  const t = String(text ?? '').trim().slice(0, 1200)
  if (!t) return null
  try {
    const res = await model.invoke([
      [
        'system',
        [
          '你是 Code 上游财务上下文分类器。判断文本是否涉及月度收支/结余等财务计算，以及某 key 是否属于公积金/社保类。',
          'schema: {"is_finance":boolean,"is_social_insurance_key":boolean,"confidence":number}'
        ].join('\n')
      ],
      ['human', t]
    ])
    const parsed = FinanceContextSchema.safeParse(safeJsonParse(String(res.content ?? '').trim()))
    if (!parsed.success || Number(parsed.data.confidence ?? 0) < 0.5) return null
    return {
      isFinance: parsed.data.is_finance,
      isSocialInsuranceKey: Boolean(parsed.data.is_social_insurance_key)
    }
  } catch {
    return null
  }
}

export async function resolveUpstreamLooksFinance(model: ChatOpenAI | null, upstream: string): Promise<boolean> {
  const structural = upstreamLooksFinanceStructural(upstream)
  if (!isCodeFinanceLlmEnabled() || structural) return structural
  const llm = await classifyFinanceContextByLlm(model, upstream)
  return llm?.isFinance ?? structural
}

export async function classifyFactKeysByLlm(
  model: ChatOpenAI | null,
  facts: Array<{ key: string; value?: unknown }>
): Promise<Map<string, FactRole> | null> {
  if (!model || !facts.length) return null
  const payload = facts
    .slice(0, 30)
    .map((f) => ({ key: String(f.key ?? '').trim(), value: String(f.value ?? '').slice(0, 80) }))
    .filter((f) => f.key)
  if (!payload.length) return null
  try {
    const res = await model.invoke([
      [
        'system',
        [
          '你是财务 facts 字段角色分类器。为每个 key 标注角色：',
          '- income/expense/balance：柱图三元组（月收支结余，单位元）',
          '- deduction：五险一金/公积金/税等扣款，不得写入柱图结余',
          '- ratio：占比/比率',
          '- metric：其它数值指标',
          '- other：无关',
          'schema: {"items":[{"key":string,"role":"income"|"expense"|"balance"|"deduction"|"ratio"|"metric"|"other"}],"confidence":number}'
        ].join('\n')
      ],
      ['human', JSON.stringify(payload)]
    ])
    const parsed = FactRolesBatchSchema.safeParse(safeJsonParse(String(res.content ?? '').trim()))
    if (!parsed.success || Number(parsed.data.confidence ?? 0) < 0.5) return null
    const out = new Map<string, FactRole>()
    for (const item of parsed.data.items) {
      const k = String(item.key ?? '').trim()
      if (k) out.set(normKey(k), item.role)
    }
    return out.size ? out : null
  } catch {
    return null
  }
}

export async function resolveFactKeyRole(
  model: ChatOpenAI | null,
  key: string,
  batchCache?: Map<string, FactRole> | null
): Promise<FactRole> {
  const nk = normKey(key)
  if (batchCache?.has(nk)) return batchCache.get(nk)!
  const structural = resolveFinanceFactKey(key)
  if (structural.social) return 'deduction'
  if (structural.finance) {
    const k = String(key ?? '').toLowerCase()
    if (k.includes('收入') || k.includes('income')) return 'income'
    if (k.includes('支出') || k.includes('expense')) return 'expense'
    if (k.includes('结余') || k.includes('balance')) return 'balance'
    if (k.includes('占比') || k.includes('ratio') || k.includes('率')) return 'ratio'
    return 'metric'
  }
  if (!model || !isCodeFinanceLlmEnabled()) return 'other'
  try {
    const res = await model.invoke([
      [
        'system',
        [
          '你是财务 fact 键名分类器。只输出 JSON。',
          'schema: {"role":"income"|"expense"|"balance"|"deduction"|"ratio"|"metric"|"other","confidence":number}'
        ].join('\n')
      ],
      ['human', `key=${key}`]
    ])
    const parsed = FactRoleSchema.safeParse(safeJsonParse(String(res.content ?? '').trim()))
    if (!parsed.success || Number(parsed.data.confidence ?? 0) < 0.5) return 'other'
    return parsed.data.role
  } catch {
    return 'other'
  }
}

function mergeNormalizedCodeJson(baseRaw: string, patch: z.infer<typeof CodeNormalizeSchema>): string {
  const txt = String(baseRaw ?? '').trim()
  if (!txt.startsWith('{')) return txt
  try {
    const obj = JSON.parse(txt) as Record<string, unknown>
    if (!patch.should_normalize) return txt
    if (patch.monthly_finance) {
      const data =
        obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data)
          ? { ...(obj.data as Record<string, unknown>) }
          : {}
      data.monthly_finance = patch.monthly_finance
      obj.data = data
    }
    if (patch.aligned_answer) obj.answer = patch.aligned_answer
    if (Array.isArray(patch.auxiliary_facts) && patch.auxiliary_facts.length) {
      const facts = Array.isArray(obj.facts) ? [...(obj.facts as unknown[])] : []
      const seen = new Set(
        facts.map((f) => normKey(String((f as { key?: string })?.key ?? ''))).filter(Boolean)
      )
      for (const af of patch.auxiliary_facts) {
        const nk = normKey(af.key)
        if (!nk || seen.has(nk)) continue
        seen.add(nk)
        facts.push({ key: af.key, value: af.value })
      }
      obj.facts = facts
    }
    return JSON.stringify(obj)
  } catch {
    return txt
  }
}

/** 通用：用启发模型校正 Code JSON（monthly_finance / answer / 扣款 facts 口径对齐） */
export async function enrichCodeFinanceOutputByLlm(
  model: ChatOpenAI | null,
  codeRaw: string,
  ctx?: { structuralTriplet?: FinanceTriplet | null; schemaRule?: string }
): Promise<string | null> {
  if (!model || !isCodeFinanceLlmEnabled()) return null
  const txt = String(codeRaw ?? '').trim()
  if (!txt.startsWith('{')) return null
  const structuralHint = ctx?.structuralTriplet
    ? `结构解析提示：income=${ctx.structuralTriplet.income}, expense=${ctx.structuralTriplet.expense}, balance=${ctx.structuralTriplet.balance}`
    : '结构解析提示：无'
  try {
    const res = await model.invoke([
      [
        'system',
        [
          '你是 Code 财务输出归一化器。输入为 Code Agent 的 JSON（含 answer/facts/data）。',
          '任务：',
          '1. 若涉及月度收支柱图：输出 data.monthly_finance = {income_yuan, expense_yuan, balance_yuan}（元，纯数字）',
          '2. balance_yuan 必须等于 income_yuan − expense_yuan（柱图口径）',
          '3. 五险一金/公积金/税等扣款只放 facts 或 auxiliary_facts，不得当作 balance_yuan',
          '4. aligned_answer 用 2～4 句概括全部关键数字；柱图结余与 monthly_finance.balance_yuan 一致；扣款单独说明',
          '5. 若输入已自洽且含合法 monthly_finance，should_normalize=false',
          ctx?.schemaRule || CODE_MONTHLY_FINANCE_SCHEMA_RULE,
          'schema: {"should_normalize":boolean,"monthly_finance":{"income_yuan":number,"expense_yuan":number,"balance_yuan":number}|omit,"aligned_answer":string|omit,"auxiliary_facts":[{"key":string,"value":string|number}]|omit,"confidence":number}'
        ].join('\n')
      ],
      ['human', [structuralHint, txt.slice(0, 6000)].join('\n\n')]
    ])
    const parsed = CodeNormalizeSchema.safeParse(safeJsonParse(String(res.content ?? '').trim()))
    if (!parsed.success || Number(parsed.data.confidence ?? 0) < 0.5) return null
    if (!parsed.data.should_normalize && !parsed.data.monthly_finance && !parsed.data.aligned_answer) return null
    return mergeNormalizedCodeJson(txt, parsed.data)
  } catch {
    return null
  }
}

/** 通用：启发模型审计最终回复/图表是否与 Code 权威数据一致 */
export async function assessFinanceConsistencyByLlm(
  model: ChatOpenAI | null,
  input: {
    codeRaw: string
    codeTriplet: FinanceTriplet
    final?: string
    visualize?: string
  }
): Promise<CodeFinanceConsistencyResult | null> {
  if (!model || !isCodeFinanceLlmEnabled()) return null
  const finalText = String(input.final ?? '').trim().slice(0, 3500)
  const vizText = String(input.visualize ?? '').trim().slice(0, 3500)
  if (!finalText && !vizText) return null
  try {
    const res = await model.invoke([
      [
        'system',
        [
          '你是 Code 权威数据一致性审计员。Code 的 data.monthly_finance 为柱图唯一数字来源。',
          '规则：',
          '- 柱图/表格的 income/expense/balance 须与 Code monthly_finance 一致（容差 1 元）',
          '- 正文若宣称另一套「结余」（如扣款后再算），与柱图冲突时：若仅文案问题 synth_only=true、retry_intent=code；若图表/表格数字错 retry_intent=visualize',
          '- 扣款类 facts 不得与柱图结余混算',
          'schema: {"pass":boolean,"reason":string,"retry_intent":"code"|"visualize"|omit,"synth_only":boolean,"confidence":number}'
        ].join('\n')
      ],
      [
        'human',
        [
          `Code 权威：${JSON.stringify({
            income_yuan: input.codeTriplet.income,
            expense_yuan: input.codeTriplet.expense,
            balance_yuan: input.codeTriplet.balance
          })}`,
          `Code 原文摘要：${String(input.codeRaw).slice(0, 1800)}`,
          finalText ? `拟回复：${finalText}` : '',
          vizText ? `visualize 输出：${vizText}` : ''
        ]
          .filter(Boolean)
          .join('\n\n')
      ]
    ])
    const parsed = ConsistencySchema.safeParse(safeJsonParse(String(res.content ?? '').trim()))
    if (!parsed.success || Number(parsed.data.confidence ?? 0) < 0.5) return null
    return {
      pass: parsed.data.pass,
      reason: parsed.data.reason,
      retryIntent: parsed.data.retry_intent,
      synthOnly: Boolean(parsed.data.synth_only)
    }
  } catch {
    return null
  }
}
