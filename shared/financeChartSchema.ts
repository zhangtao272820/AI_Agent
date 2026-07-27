/**
 * 收支柱状图：由模型在 Code / visualize 中输出约定 schema，运行时只做 JSON 字段读取（无业务正则）。
 *
 * @deprecated 主路径已迁移至通用 Code 权威 + planChartFromCodeByLlm / buildChartPlanFromFactsStructural。
 * 本模块仅保留 monthly_finance 结构校正与 finance smoke 兼容；勿新增领域规则。
 */

import { mergeFactsWithCodePriority } from './codeFirstAuthority'

export type FinanceTriplet = {
  income: number
  expense: number
  balance: number
  source?: string
  incomeLabel?: string
}

/** Code 步骤必须输出的收支柱状图数据（模型自检用） */
export const CODE_MONTHLY_FINANCE_SCHEMA_RULE =
  '【收支柱状图 schema】若任务需要「收入/支出/结余」柱状图：在 JSON 根级输出 data.monthly_finance = { "income_yuan": number, "expense_yuan": number, "balance_yuan": number }（单位：元，纯数字）。**balance_yuan 必须等于 income_yuan − expense_yuan**；五险一金/公积金等扣款只放 facts 或 data.deductions，禁止写入 balance_yuan。占比/比率只放 data.ratios，禁止把占比写入 monthly_finance。'

export const VISUALIZE_MONTHLY_FINANCE_CHART_RULE =
  '【收支柱状图】若上下文 Code 含 data.monthly_finance：ECharts 三根柱的 series.data 必须依次为 income_yuan、expense_yuan、balance_yuan（元），不得使用任何占比或比率数字。无 monthly_finance 时说明缺字段，勿从占比推算柱高。'

export const REPORT_MONTHLY_FINANCE_RULE =
  '【收支报告】正文中的收入/支出/结余金额须与 Code 的 data.monthly_finance 一致；占比仅作说明，不得当作金额。'

export const CODE_MONTHLY_FINANCE_JSON_EXAMPLE = `{
  "answer": "…",
  "facts": [
    { "key": "月收入", "value": 6000 },
    { "key": "月支出", "value": 5000 },
    { "key": "月结余", "value": 1000 }
  ],
  "data": {
    "monthly_finance": { "income_yuan": 6000, "expense_yuan": 5000, "balance_yuan": 1000 },
    "ratios": [{ "key": "expense_ratio", "value": "83.33%" }]
  }
}`

const EXACT_INCOME_KEYS = new Set(['月收入', 'monthly_income', 'income_yuan'])
const EXACT_EXPENSE_KEYS = new Set(['月支出', 'monthly_expense', 'expense_yuan'])
const EXACT_BALANCE_KEYS = new Set(['月结余', 'monthly_balance', 'balance_yuan', '结余'])

export function coerceYuanNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const s = String(value ?? '').trim()
  if (!s) return null
  if (s.includes('%') || s.includes('％')) return null
  let cleaned = ''
  for (const ch of s) {
    if (ch === ',' || ch === '，' || ch === ' ') continue
    cleaned += ch
  }
  if (!cleaned) return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

type FactLike = { key?: string; value?: unknown }

/** 收支柱图口径：schema 缺失结余时补 income−expense；显式 facts 结余保留 */
export function reconcileMonthlyFinanceTriplet(t: FinanceTriplet | null): FinanceTriplet | null {
  if (!t) return null
  const { income, expense } = t
  if (!Number.isFinite(income) || !Number.isFinite(expense)) return t
  const computed = income - expense
  const tol = 0.01
  if (t.balance == null || !Number.isFinite(t.balance)) {
    return {
      ...t,
      balance: computed,
      incomeLabel: t.incomeLabel
    }
  }
  if (t.source === 'schema' && Math.abs(t.balance - computed) > tol) {
    return {
      ...t,
      balance: computed,
      incomeLabel: [t.incomeLabel, '结余已按 income−expense 校正'].filter(Boolean).join('；')
    }
  }
  return t
}

function readMonthlyFinanceBlock(block: unknown): FinanceTriplet | null {
  if (!block || typeof block !== 'object' || Array.isArray(block)) return null
  const m = block as Record<string, unknown>
  const income = coerceYuanNumber(m.income_yuan ?? m.incomeYuan ?? m.income)
  const expense = coerceYuanNumber(m.expense_yuan ?? m.expenseYuan ?? m.expense)
  let balance = coerceYuanNumber(m.balance_yuan ?? m.balanceYuan ?? m.balance)
  if (income == null || expense == null) return null
  if (balance == null) balance = income - expense
  if (!Number.isFinite(balance)) return null
  return reconcileMonthlyFinanceTriplet({
    income,
    expense,
    balance,
    source: 'schema',
    incomeLabel: 'Code monthly_finance'
  })
}

/** 从 payload.data.monthly_finance（或 chart_series）读取，供图表/报告使用 */
export function tripletFromMonthlyFinanceData(data: unknown): FinanceTriplet | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const root = data as Record<string, unknown>
  const block = root.monthly_finance ?? root.monthlyFinance ?? root.chart_series
  return readMonthlyFinanceBlock(block)
}

/** 仅从约定 fact 键名读取（精确匹配，不模糊匹配「支出」等） */
export function tripletFromExactFinanceFacts(facts: FactLike[]): FinanceTriplet | null {
  let income: number | null = null
  let expense: number | null = null
  let balance: number | null = null

  for (const f of facts) {
    const key = String(f?.key ?? '').trim()
    if (!key) continue
    const val = coerceYuanNumber(f?.value)
    if (val == null) continue
    if (EXACT_INCOME_KEYS.has(key)) income = val
    else if (EXACT_EXPENSE_KEYS.has(key)) expense = val
    else if (EXACT_BALANCE_KEYS.has(key)) balance = val
  }

  if (income == null || expense == null) return null
  if (balance == null) balance = income - expense
  return reconcileMonthlyFinanceTriplet({
    income,
    expense,
    balance,
    source: 'exact_facts',
    incomeLabel: '结构化 facts'
  })
}

export type FinancePickContext = {
  results?: Record<string, unknown>
  extractPayload?: (raw: string) => { facts?: FactLike[]; data?: unknown; answer?: string }
}

function parseAgentPayload(
  raw: string,
  extractPayload?: FinancePickContext['extractPayload'],
): { facts: FactLike[]; data?: unknown } {
  const txt = String(raw ?? '').trim()
  if (!txt) return { facts: [] }
  if (extractPayload) {
    const p = extractPayload(txt)
    return { facts: Array.isArray(p.facts) ? p.facts : [], data: p.data }
  }
  if (!txt.startsWith('{')) return { facts: [] }
  try {
    const obj = JSON.parse(txt) as Record<string, unknown>
    const facts = Array.isArray(obj.facts) ? (obj.facts as FactLike[]) : []
    return { facts, data: obj.data }
  } catch {
    return { facts: [] }
  }
}

/** 仅从 Code 步骤解析收支三元组（禁止回落到 RAG/DB/爬虫，避免图表/报告瞎猜上游裸数） */
export function resolveCodeAuthorityTriplet(ctx?: FinancePickContext): FinanceTriplet | null {
  const results = ctx?.results && typeof ctx.results === 'object' ? ctx.results : null
  const extractPayload = ctx.extractPayload
  const codeRaw = String(results?.code ?? '').trim()
  if (!codeRaw) return null

  const { facts, data } = parseAgentPayload(codeRaw, extractPayload)
  const fromSchema = tripletFromMonthlyFinanceData(data)
  if (fromSchema) return reconcileMonthlyFinanceTriplet({ ...fromSchema, source: 'code' })
  const fromFacts = tripletFromExactFinanceFacts(facts)
  if (fromFacts) return reconcileMonthlyFinanceTriplet({ ...fromFacts, source: 'code' })
  const fromAnswer = pickMonthlyFinanceTriplet(codeRaw, extractPayload)
  if (fromAnswer) return reconcileMonthlyFinanceTriplet({ ...fromAnswer, source: 'code_answer' })
  return null
}

export type CodeFinanceConsistencyResult = {
  pass: boolean
  reason?: string
  retryIntent?: 'code' | 'visualize'
  synthOnly?: boolean
}

/** Code 步骤产出后：结构层校正 monthly_finance 与结余 facts（语义对齐交给启发模型） */
export function normalizeCodeFinanceOutputStructural(
  codeRaw: string,
  extractPayload?: FinancePickContext['extractPayload']
): string {
  const txt = String(codeRaw ?? '').trim()
  if (!txt.startsWith('{')) return txt
  const triplet = resolveCodeAuthorityTriplet({ results: { code: txt }, extractPayload })
  if (!triplet) return txt
  try {
    const obj = JSON.parse(txt) as Record<string, unknown>
    const data =
      obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data)
        ? { ...(obj.data as Record<string, unknown>) }
        : ({} as Record<string, unknown>)
    data.monthly_finance = {
      income_yuan: triplet.income,
      expense_yuan: triplet.expense,
      balance_yuan: triplet.balance
    }
    obj.data = data
    if (Array.isArray(obj.facts)) {
      obj.facts = (obj.facts as FactLike[]).map((f) => {
        const key = String(f?.key ?? '').trim()
        if (EXACT_BALANCE_KEYS.has(key)) return { ...f, value: triplet.balance }
        return f
      })
    }
    return JSON.stringify(obj)
  } catch {
    return txt
  }
}

/** @deprecated 请用 normalizeCodeFinanceOutputStructural 或 server/utils/code/managerCodeFinanceNormalize 异步管线 */
export function normalizeCodeFinanceOutput(
  codeRaw: string,
  extractPayload?: FinancePickContext['extractPayload']
): string {
  return normalizeCodeFinanceOutputStructural(codeRaw, extractPayload)
}

/** 有 Code 时仅采信 Code；无 Code 时可合并上游 facts */
export function resolveMonthlyFinanceTriplet(ctx?: FinancePickContext): FinanceTriplet | null {
  const results = ctx?.results && typeof ctx.results === 'object' ? ctx.results : null
  const extractPayload = ctx.extractPayload

  if (results) {
    const codeRaw = String(results.code ?? '').trim()
    if (codeRaw) {
      return resolveCodeAuthorityTriplet(ctx)
    }

    if (extractPayload) {
      const merged = mergeFactsWithCodePriority(results as Record<string, unknown>, extractPayload)
      const fromMerged = tripletFromExactFinanceFacts(merged.map((f) => ({ key: f.key, value: f.value })))
      if (fromMerged) {
        return {
          ...fromMerged,
          source: 'upstream_merged',
          incomeLabel: fromMerged.incomeLabel || '合并 facts'
        }
      }
    }
  }

  return null
}

export function pickMonthlyFinanceTriplet(
  text: string,
  extractPayload?: FinancePickContext['extractPayload'],
): FinanceTriplet | null {
  const { facts, data } = parseAgentPayload(String(text || ''), extractPayload)
  return tripletFromMonthlyFinanceData(data) ?? tripletFromExactFinanceFacts(facts)
}
