/**
 * 通用表格/排名 → ECharts 确定性规划（非财务专用）。
 * Code / DB 可在 data.tabular_rows 或 data.ranking 中输出约定结构。
 */

import type { LlmChartPlan } from './codeAuthorityPayload'

export type TabularRow = { label: string; value: number; displayValue?: string }

function coerceNum(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const s = String(value ?? '').trim()
  if (!s || s.includes('%') || s.includes('％')) return null
  let cleaned = ''
  for (const ch of s) {
    if (ch === ',' || ch === '，' || ch === ' ') continue
    cleaned += ch
  }
  if (!cleaned) return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

function rowFromRecord(row: Record<string, unknown>): TabularRow | null {
  const label = String(row.label ?? row.name ?? row.title ?? row.category ?? row.key ?? '').trim()
  const value = coerceNum(row.value ?? row.amount ?? row.count ?? row.total ?? row.score ?? row.y)
  if (!label || value == null) return null
  return {
    label,
    value,
    displayValue: String(row.displayValue ?? row.display ?? row.value ?? value).trim() || undefined
  }
}

/** 从 Code/DB data 块读取 tabular_rows / ranking / rows */
export function parseTabularRowsFromData(data: unknown): TabularRow[] | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const root = data as Record<string, unknown>
  const block = root.tabular_rows ?? root.tabularRows ?? root.ranking ?? root.rankings ?? root.rows
  let arr: unknown[] = []
  if (Array.isArray(block)) {
    arr = block
  } else if (block && typeof block === 'object' && !Array.isArray(block)) {
    const nested = block as Record<string, unknown>
    arr = Array.isArray(nested.rows) ? nested.rows : Array.isArray(nested.items) ? nested.items : []
  }
  const rows = arr
    .map((x) => (x && typeof x === 'object' && !Array.isArray(x) ? rowFromRecord(x as Record<string, unknown>) : null))
    .filter((x): x is TabularRow => Boolean(x))

  const matrix = parseMatrixFromData(data)
  if (matrix && matrix.rows.length >= 2 && matrix.cols.length >= 2) {
    return null
  }

  return rows.length >= 2 ? rows : null
}

export type TabularMatrix = {
  rows: string[]
  cols: string[]
  values: number[][]
}

/** data.matrix / data.heatmap：{ rows, columns|cols, values|data } */
export function parseMatrixFromData(data: unknown): TabularMatrix | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const root = data as Record<string, unknown>
  const block = root.matrix ?? root.heatmap
  if (!block || typeof block !== 'object' || Array.isArray(block)) return null
  const m = block as Record<string, unknown>
  const rows = (Array.isArray(m.rows) ? m.rows : []).map((r) => String(r ?? '').trim()).filter(Boolean)
  const colsRaw = m.columns ?? m.cols ?? m.x_labels ?? m.xLabels
  const cols = (Array.isArray(colsRaw) ? colsRaw : []).map((c) => String(c ?? '').trim()).filter(Boolean)
  const valuesRaw = m.values ?? m.data
  if (!Array.isArray(valuesRaw) || !rows.length || !cols.length) return null
  const values: number[][] = []
  for (const row of valuesRaw) {
    if (!Array.isArray(row)) return null
    const nums = row.map((v) => coerceNum(v)).map((n) => (n == null ? 0 : n))
    if (nums.length !== cols.length) return null
    values.push(nums)
  }
  if (values.length !== rows.length || values.length < 2 || cols.length < 2) return null
  return { rows, cols, values }
}

export function buildChartPlanFromMatrix(matrix: TabularMatrix, title = '热力图'): LlmChartPlan | null {
  if (!matrix.rows.length || !matrix.cols.length) return null
  const series = matrix.rows.flatMap((rowLabel, ri) =>
    matrix.cols.map((colLabel, ci) => ({
      label: `${rowLabel}·${colLabel}`,
      value: matrix.values[ri]?.[ci] ?? 0,
      displayValue: String(matrix.values[ri]?.[ci] ?? 0),
      sourceKey: `${rowLabel}_${colLabel}`,
      unitKind: 'count' as const,
      comparableGroup: 'matrix_cell'
    }))
  )
  return {
    chartTitle: title,
    chartNote: '基于 matrix/heatmap 数据确定性生成',
    panels: [
      {
        panelTitle: title,
        chartType: 'heatmap',
        unitKind: 'count',
        visualRole: 'distribution',
        comparableGroup: 'matrix',
        series: series.slice(0, 48)
      }
    ]
  }
}

/** facts 形如「类目：数值」时退化为排名柱图 */
export function rowsFromRankedFacts(facts: Array<{ key?: string; value?: unknown }>): TabularRow[] | null {
  const rows: TabularRow[] = []
  for (const f of facts) {
    const label = String(f?.key ?? '').trim()
    const value = coerceNum(f?.value)
    if (!label || value == null) continue
    rows.push({ label, value, displayValue: String(f?.value ?? value) })
  }
  return rows.length >= 2 ? rows : null
}

const MD_TABLE_SEP = /^[\s|:-]+$/

function isMarkdownTableSeparator(cells: string[]): boolean {
  return cells.length >= 2 && cells.every((c) => MD_TABLE_SEP.test(c))
}

/** 从 DB/Agent 输出的 Markdown 表格解析 label + 数值列（确定性出图） */
export function parseMarkdownTableAsTabularRows(text: string): TabularRow[] | null {
  const rows: TabularRow[] = []
  for (const line of String(text || '').split('\n')) {
    if (!line.includes('|')) continue
    const cells = line
      .split('|')
      .map((c) => c.trim())
      .filter((c) => c.length > 0)
    if (cells.length < 2) continue
    if (isMarkdownTableSeparator(cells)) continue
    const label = cells[0]!
    if (/^(名称|name|项目|label|序号|#|排名|region|地区)$/i.test(label)) continue
    let value: number | null = null
    let displayValue: string | undefined
    for (let i = 1; i < cells.length; i++) {
      const n = coerceNum(cells[i])
      if (n != null) {
        value = n
        displayValue = cells[i]
        break
      }
    }
    if (!label || value == null) continue
    rows.push({ label, value, displayValue: displayValue ?? String(value) })
  }
  return rows.length >= 2 ? rows : null
}

export function buildChartPlanFromTabularRows(rows: TabularRow[], title = '数据图表'): LlmChartPlan | null {
  if (!rows.length) return null
  const sorted = [...rows].sort((a, b) => b.value - a.value).slice(0, 20)
  const chartType = sorted.length <= 6 ? ('bar' as const) : ('horizontal_bar' as const)
  return {
    chartTitle: title,
    chartNote: '基于 tabular_rows / 排名数据确定性生成（未调用 visualize LLM）',
    panels: [
      {
        panelTitle: title,
        chartType,
        unitKind: 'count',
        visualRole: 'comparison',
        comparableGroup: 'tabular_rank',
        series: sorted.map((r) => ({
          label: r.label,
          value: r.value,
          displayValue: r.displayValue ?? String(r.value),
          sourceKey: r.label,
          unitKind: 'count' as const,
          comparableGroup: 'tabular_rank'
        }))
      }
    ],
    tableRows: sorted.map((r) => ({ label: r.label, value: r.displayValue ?? String(r.value) }))
  }
}
