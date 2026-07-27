/**
 * @deprecated 财务专用模块。新功能请使用 shared/chartOption.ts + managerCodeAuthorityLlm.ts（通用 Code 权威管线）。
 * 前端已不再调用 resolveMonthlyFinanceTriplet / normalizeMonthlyFinanceBarOption。
 */
import type { FinancePickContext, FinanceTriplet } from './financeChartSchema'
import {
  CODE_MONTHLY_FINANCE_SCHEMA_RULE,
  CODE_MONTHLY_FINANCE_JSON_EXAMPLE,
  REPORT_MONTHLY_FINANCE_RULE,
  VISUALIZE_MONTHLY_FINANCE_CHART_RULE,
  coerceYuanNumber,
  pickMonthlyFinanceTriplet,
  resolveCodeAuthorityTriplet,
  resolveMonthlyFinanceTriplet,
  tripletFromExactFinanceFacts,
  tripletFromMonthlyFinanceData,
  reconcileMonthlyFinanceTriplet,
  normalizeCodeFinanceOutputStructural,
  type CodeFinanceConsistencyResult
} from './financeChartSchema'

export type { FinanceTriplet, FinancePickContext, CodeFinanceConsistencyResult } from './financeChartSchema'
export {
  CODE_MONTHLY_FINANCE_SCHEMA_RULE,
  CODE_MONTHLY_FINANCE_JSON_EXAMPLE,
  REPORT_MONTHLY_FINANCE_RULE,
  VISUALIZE_MONTHLY_FINANCE_CHART_RULE,
  coerceYuanNumber,
  pickMonthlyFinanceTriplet,
  resolveMonthlyFinanceTriplet,
  tripletFromExactFinanceFacts,
  tripletFromMonthlyFinanceData,
  resolveCodeAuthorityTriplet,
  reconcileMonthlyFinanceTriplet,
  normalizeCodeFinanceOutputStructural
} from './financeChartSchema'

function extractTaggedBlockLocal(raw: string, tag: string): string | null {
  const open = `<!--${tag}-->`
  const close = `<!--/${tag}-->`
  const text = String(raw || '')
  const start = text.indexOf(open)
  if (start < 0) return null
  const bodyStart = start + open.length
  const end = text.indexOf(close, bodyStart)
  if (end < 0) return null
  return text.slice(bodyStart, end).trim()
}

function stripTaggedBlockLocal(raw: string, tag: string): string {
  const open = `<!--${tag}-->`
  const close = `<!--/${tag}-->`
  const text = String(raw || '')
  const start = text.indexOf(open)
  if (start < 0) return text
  const end = text.indexOf(close, start)
  if (end < 0) return text
  return (text.slice(0, start) + text.slice(end + close.length)).trim()
}

function chartCategoryLabels(option: unknown): string[] {
  const xAxis = (option as { xAxis?: unknown })?.xAxis
  if (!xAxis) return []
  const row = Array.isArray(xAxis) ? xAxis[0] : xAxis
  const cats = (row as { data?: unknown[] } | undefined)?.data
  return Array.isArray(cats) ? cats.map((x) => String(x)) : []
}

export function isMonthlyFinanceBarOption(option: unknown): boolean {
  const labels = chartCategoryLabels(option)
  return labels.includes('收入') && labels.includes('支出') && labels.includes('结余')
}

/** 仅当 Code 已输出 monthly_finance schema 时校正柱图数据 */
export function normalizeMonthlyFinanceBarOption(
  option: unknown,
  _sourceText?: string,
  ctx?: FinancePickContext,
): unknown {
  if (!option || !isMonthlyFinanceBarOption(option)) return option
  const triplet = ctx ? resolveMonthlyFinanceTriplet(ctx) : null
  if (!triplet) return option
  const o = JSON.parse(JSON.stringify(option)) as Record<string, unknown>
  const series = Array.isArray(o.series) ? [...(o.series as unknown[])] : o.series ? [o.series] : []
  const first = series[0] as Record<string, unknown> | undefined
  if (first) {
    first.data = [triplet.income, triplet.expense, triplet.balance]
    o.series = series
  }
  return o
}

export function buildMonthlyFinanceBarOption(income: number, expense: number, balance: number) {
  return {
    title: { text: '月度收支概览' },
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: ['收入', '支出', '结余'] },
    yAxis: { type: 'value' },
    series: [{ type: 'bar', data: [income, expense, balance] }]
  }
}

function seriesNumericValues(option: unknown): number[] {
  const o = option as { series?: unknown | unknown[] }
  const series = Array.isArray(o?.series) ? o.series : o?.series ? [o.series] : []
  const out: number[] = []
  for (const s of series) {
    const row = s as { data?: unknown[] }
    const data = Array.isArray(row?.data) ? row.data : []
    for (const d of data) {
      const n =
        typeof d === 'number'
          ? d
          : typeof d === 'object' && d != null
            ? Number((d as { value?: unknown }).value)
            : NaN
      if (Number.isFinite(n)) out.push(n)
    }
  }
  return out
}

export function isPartialFinanceChart(option: unknown): boolean {
  if (!isMonthlyFinanceBarOption(option)) return false
  const vals = seriesNumericValues(option)
  if (vals.length < 3) return false
  const income = vals[0] ?? 0
  const expense = vals[1] ?? 0
  const balance = vals[2] ?? 0
  return income > 0 && expense === 0 && balance === 0
}

export function isEmptyOrZeroFinanceChart(option: unknown): boolean {
  if (!option) return true
  if (isPartialFinanceChart(option)) return true
  const vals = seriesNumericValues(option)
  if (!vals.length) return true
  return vals.every((v) => !Number.isFinite(v) || v === 0)
}

export function shouldEmitFinanceChart(option: unknown): boolean {
  if (!option) return false
  return !isEmptyOrZeroFinanceChart(option)
}

/** 仅在有 Code 权威三元组时覆盖 ECharts 柱数据 */
export function rewriteVisualizeFinanceEcharts(text: string, ctx: FinancePickContext): string {
  const triplet =
    (ctx.results && String(ctx.results.code ?? '').trim()
      ? resolveCodeAuthorityTriplet(ctx)
      : null) ?? resolveMonthlyFinanceTriplet(ctx)
  if (!triplet) return String(text || '')
  const blockBody = extractTaggedBlockLocal(String(text || ''), 'ECHARTS_OPTION')
  if (!blockBody) return String(text || '')
  try {
    let option = JSON.parse(blockBody)
    option = normalizeMonthlyFinanceBarOption(option, undefined, ctx)
    if (isEmptyOrZeroFinanceChart(option)) {
      return stripTaggedBlockLocal(String(text || ''), 'ECHARTS_OPTION').trim()
    }
    const open = '<!--ECHARTS_OPTION-->'
    const close = '<!--/ECHARTS_OPTION-->'
    const wrapped = `${open}\n${JSON.stringify(option, null, 2)}\n${close}`
    const raw = String(text || '')
    const start = raw.indexOf(open)
    const end = raw.indexOf(close, start >= 0 ? start : 0)
    if (start < 0 || end < 0) return raw
    return `${raw.slice(0, start)}${wrapped}${raw.slice(end + close.length)}`
  } catch {
    return String(text || '')
  }
}

export function financeChartTextMismatch(
  triplet: FinanceTriplet | null,
  prose: string,
  tolerance = 80,
  extractPayload?: FinancePickContext['extractPayload'],
): string | null {
  if (!triplet) return null
  const proseTriplet = pickMonthlyFinanceTriplet(prose, extractPayload)
  if (!proseTriplet) return null
  const issues: string[] = []
  if (Math.abs(proseTriplet.income - triplet.income) > tolerance) {
    issues.push(`收入不一致（图表 ${triplet.income} vs 正文 ${proseTriplet.income}）`)
  }
  if (Math.abs(proseTriplet.expense - triplet.expense) > tolerance) {
    issues.push(`支出不一致（图表 ${triplet.expense} vs 正文 ${proseTriplet.expense}）`)
  }
  if (Math.abs(proseTriplet.balance - triplet.balance) > tolerance) {
    issues.push(`结余不一致（图表 ${triplet.balance} vs 正文 ${proseTriplet.balance}）`)
  }
  return issues.length ? issues.join('；') : null
}

function parseMarkdownTableLabelValue(text: string, label: string): number | null {
  const target = String(label ?? '').trim()
  if (!target) return null
  let last: number | null = null
  for (const line of String(text || '').split('\n')) {
    if (!line.includes('|')) continue
    const cells = line
      .split('|')
      .map((c) => c.trim())
      .filter((c) => c.length > 0)
    if (cells.length < 2) continue
    if (cells[0] === target) {
      const n = coerceYuanNumber(cells[1])
      if (n != null) last = n
    }
  }
  return last
}

/** 从 Markdown 表格读取收入/支出/结余（取最后一次出现的表） */
export function tripletFromFinanceMarkdownTables(text: string): FinanceTriplet | null {
  const income = parseMarkdownTableLabelValue(text, '收入')
  const expense = parseMarkdownTableLabelValue(text, '支出')
  let balance = parseMarkdownTableLabelValue(text, '结余')
  if (income == null || expense == null) return null
  if (balance == null) balance = income - expense
  return reconcileMonthlyFinanceTriplet({
    income,
    expense,
    balance,
    source: 'markdown_table',
    incomeLabel: '表格'
  })
}

/** 从 ECHARTS_OPTION 块读取收支柱数据 */
export function tripletFromEchartsBlock(text: string): FinanceTriplet | null {
  const blockBody = extractTaggedBlockLocal(String(text || ''), 'ECHARTS_OPTION')
  if (!blockBody) return null
  try {
    const option = JSON.parse(blockBody)
    if (!isMonthlyFinanceBarOption(option)) return null
    const vals = seriesNumericValues(option)
    if (vals.length < 3) return null
    return reconcileMonthlyFinanceTriplet({
      income: vals[0],
      expense: vals[1],
      balance: vals[2],
      source: 'echarts',
      incomeLabel: '图表'
    })
  } catch {
    return null
  }
}

function tripletMismatchIssues(
  authority: FinanceTriplet,
  other: FinanceTriplet,
  otherLabel: string,
  tolerance = 1,
): string[] {
  const issues: string[] = []
  if (Math.abs(other.income - authority.income) > tolerance) {
    issues.push(`收入不一致（Code ${authority.income} vs ${otherLabel} ${other.income}）`)
  }
  if (Math.abs(other.expense - authority.expense) > tolerance) {
    issues.push(`支出不一致（Code ${authority.expense} vs ${otherLabel} ${other.expense}）`)
  }
  if (Math.abs(other.balance - authority.balance) > tolerance) {
    issues.push(`结余不一致（Code ${authority.balance} vs ${otherLabel} ${other.balance}）`)
  }
  return issues
}

/** 结构层校验：图表/表格/结构化 JSON 与 Code 权威三元组 */
export function assessCodeFinanceConsistencyStructural(params: {
  final?: string
  results?: Record<string, unknown>
  extractPayload?: FinancePickContext['extractPayload']
}): CodeFinanceConsistencyResult {
  const results = params.results && typeof params.results === 'object' ? params.results : {}
  const codeRaw = String(results.code ?? '').trim()
  if (!codeRaw) return { pass: true }

  const codeTriplet = resolveCodeAuthorityTriplet({
    results,
    extractPayload: params.extractPayload
  })
  if (!codeTriplet) return { pass: true }

  const finalText = String(params.final || '').trim()
  const vizText = String(results.visualize ?? '').trim()
  const combined = [finalText, vizText].filter(Boolean).join('\n\n')
  const issues: string[] = []

  const chartTriplet =
    tripletFromEchartsBlock(finalText) ?? tripletFromEchartsBlock(vizText)
  if (chartTriplet) {
    issues.push(...tripletMismatchIssues(codeTriplet, chartTriplet, '图表', 1))
  }

  const tableTriplet = tripletFromFinanceMarkdownTables(combined)
  if (tableTriplet) {
    issues.push(...tripletMismatchIssues(codeTriplet, tableTriplet, '表格', 1))
  }

  const structuredMismatch = financeChartTextMismatch(codeTriplet, finalText, 1, params.extractPayload)
  if (structuredMismatch) issues.push(structuredMismatch)

  if (!issues.length) return { pass: true }

  const chartOrTableWrong = issues.some((i) => i.includes('图表') || i.includes('表格'))

  return {
    pass: false,
    reason: issues.join('；'),
    retryIntent: chartOrTableWrong ? 'visualize' : 'code',
    synthOnly: false
  }
}

/** @deprecated 同步别名；critic 请用 server/utils/code/managerCodeFinanceNormalize.assessCodeFinanceConsistencyAsync */
export function assessCodeFinanceConsistency(params: {
  final?: string
  results?: Record<string, unknown>
  extractPayload?: FinancePickContext['extractPayload']
}): CodeFinanceConsistencyResult {
  return assessCodeFinanceConsistencyStructural(params)
}

/** @deprecated 无 schema 时不再从正文猜数；保留导出避免旧引用报错 */
export function parseAmountToken(raw: string): number | null {
  const s = String(raw ?? '').trim()
  if (!s || s.includes('%') || s.includes('％')) return null
  let cleaned = ''
  for (const ch of s) {
    if (ch === ',' || ch === '，') continue
    cleaned += ch
  }
  const v = Number(cleaned)
  return Number.isFinite(v) ? v : null
}
