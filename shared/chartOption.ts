/**
 * 通用 ECharts option 结构校验/归一化（无领域 regex、无财务专用逻辑）。
 */

function extractTaggedBlockBody(raw: string, tag: string): string | null {
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

export function readEchartsOptionJsonFromVisualizeText(text: string): unknown | null {
  const body = extractTaggedBlockBody(String(text ?? ''), 'ECHARTS_OPTION')
  if (!body) return null
  try {
    return JSON.parse(body) as unknown
  } catch {
    return null
  }
}

export function isVisualizeOutputRenderable(text: string): boolean {
  const opt = readEchartsOptionJsonFromVisualizeText(text)
  return opt != null && isRenderableChartOption(opt)
}

export function readChartTitle(option: unknown): string {
  if (!option || typeof option !== 'object') return ''
  const title = (option as { title?: unknown }).title
  if (typeof title === 'string') return title.trim()
  if (Array.isArray(title) && title.length) {
    const first = title[0]
    if (typeof first === 'string') return first.trim()
    if (first && typeof first === 'object' && typeof (first as { text?: unknown }).text === 'string') {
      return String((first as { text: string }).text).trim()
    }
  }
  if (title && typeof title === 'object' && typeof (title as { text?: unknown }).text === 'string') {
    return String((title as { text: string }).text).trim()
  }
  return ''
}

export function seriesPointCount(option: unknown): number {
  const o = option as { series?: unknown | unknown[] }
  const series = Array.isArray(o?.series) ? o.series : o?.series ? [o.series] : []
  let n = 0
  for (const s of series) {
    const item = s as { data?: unknown[]; type?: string }
    const data = item?.data
    if (!Array.isArray(data)) continue
    if (item.type === 'radar' && data[0] && typeof data[0] === 'object' && !Array.isArray(data[0])) {
      const vals = (data[0] as { value?: unknown[] }).value
      if (Array.isArray(vals)) {
        n += vals.length
        continue
      }
    }
    n += data.length
  }
  return n
}

/** 是否具备可渲染的最小结构（至少 1 个 series 且含 data） */
export function isRenderableChartOption(option: unknown): boolean {
  if (!option || typeof option !== 'object') return false
  const o = option as { series?: unknown | unknown[] }
  const series = Array.isArray(o.series) ? o.series : o.series ? [o.series] : []
  if (!series.length) return false
  return series.some((s) => {
    const data = (s as { data?: unknown })?.data
    return Array.isArray(data) && data.length > 0
  })
}

/** 读取堆叠 panel 数量（供前端动态高度） */
export function readPanelCount(option: unknown): number {
  if (!option || typeof option !== 'object') return 1
  const layout = (option as { _layout?: { panelCount?: unknown } })._layout
  const n = Number(layout?.panelCount)
  if (Number.isFinite(n) && n >= 1) return Math.floor(n)
  const grids = (option as { grid?: unknown | unknown[] }).grid
  if (Array.isArray(grids) && grids.length > 1) return grids.length
  return 1
}

/** 根据 panel 数、类目数、图表类型建议容器高度（px） */
export function readCategoryCount(option: unknown): number {
  if (!option || typeof option !== 'object') return 0
  const layout = (option as { _layout?: { categoryCount?: unknown } })._layout
  const hinted = Number(layout?.categoryCount)
  if (Number.isFinite(hinted) && hinted >= 1) return Math.floor(hinted)

  const o = option as { yAxis?: unknown | unknown[]; xAxis?: unknown | unknown[]; series?: unknown[] }
  const yAxes = Array.isArray(o.yAxis) ? o.yAxis : o.yAxis ? [o.yAxis] : []
  for (const ax of yAxes) {
    const data = (ax as { data?: unknown[]; type?: string })?.data
    if (Array.isArray(data) && data.length && (ax as { type?: string }).type === 'category') {
      return data.length
    }
  }
  const xAxes = Array.isArray(o.xAxis) ? o.xAxis : o.xAxis ? [o.xAxis] : []
  for (const ax of xAxes) {
    const data = (ax as { data?: unknown[]; type?: string })?.data
    if (Array.isArray(data) && data.length && (ax as { type?: string }).type === 'category') {
      return data.length
    }
  }
  const series = Array.isArray(o.series) ? o.series : []
  let max = 0
  for (const s of series) {
    const data = (s as { data?: unknown[] })?.data
    if (Array.isArray(data)) max = Math.max(max, data.length)
  }
  return max
}

export function readPrimaryChartType(option: unknown): string {
  if (!option || typeof option !== 'object') return 'bar'
  const layout = (option as { _layout?: { primaryChartType?: unknown } })._layout
  const hinted = String(layout?.primaryChartType ?? '').trim()
  if (hinted) return hinted
  const series = (option as { series?: unknown[] }).series
  const first = Array.isArray(series) ? series[0] : null
  return String((first as { type?: unknown })?.type ?? 'bar')
}

export function readGaugeCount(option: unknown): number {
  if (!option || typeof option !== 'object') return 0
  const series = (option as { series?: unknown[] }).series
  if (!Array.isArray(series)) return 0
  return series.filter((s) => String((s as { type?: unknown }).type ?? '') === 'gauge').length
}

export function suggestChartContainerHeight(option: unknown): number {
  const panels = readPanelCount(option)
  const categories = readCategoryCount(option)
  const chartType = readPrimaryChartType(option)
  const gaugeCount = readGaugeCount(option)
  const isHorizontal = chartType === 'horizontal_bar'

  let h = 320
  if (panels > 1) {
    h = 280 + (panels - 1) * 220
  }
  if (gaugeCount > 0) {
    h = Math.max(h, 200 + gaugeCount * 180 + (panels > gaugeCount ? 160 : 0))
  }
  if (isHorizontal && categories >= 1) {
    h = Math.max(h, 120 + categories * 56 + (panels === 1 ? 96 : 48))
  } else if (categories >= 5) {
    h = Math.max(h, 300 + (categories - 4) * 32)
  }
  return Math.min(960, h)
}

/** 结构层补全：仅保证 ECharts 必要字段存在，不改业务数字 */
export function normalizeChartOptionStructural(option: unknown): Record<string, unknown> | null {
  if (!option || typeof option !== 'object') return null
  const base = { ...(option as Record<string, unknown>) }
  if (!base.tooltip) base.tooltip = { trigger: 'axis' }
  if (!isRenderableChartOption(base)) return null
  return base
}
