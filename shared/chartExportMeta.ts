import { readChartTitle, readPanelCount, readPrimaryChartType, suggestChartContainerHeight } from './chartOption'

export type ChartPngExportMeta = {
  filename: string
  title: string
  subtitle: string
  width: number
  height: number
  chartType: string
  panelCount: number
  exportedAt: string
}

function slugifyTitle(title: string): string {
  const t = String(title ?? '')
    .trim()
    .slice(0, 48)
    .replace(/[^\w\u4e00-\u9fff-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
  return t || 'chart'
}

/** 与前端 downloadEchartsPng 对齐的导出元数据 */
export function buildChartPngExportMeta(
  option: unknown,
  ctx?: { filenameHint?: string; runId?: string; source?: string }
): ChartPngExportMeta {
  const title = readChartTitle(option) || '数据图表'
  const width = 800
  const height = suggestChartContainerHeight(option)
  const chartType = readPrimaryChartType(option)
  const panelCount = readPanelCount(option)
  const base = ctx?.filenameHint ? slugifyTitle(ctx.filenameHint) : slugifyTitle(title)
  const stamp = new Date().toISOString().slice(0, 10)
  const filename = `${base}_${chartType}_p${panelCount}_${stamp}.png`
  const subtitle = [
    ctx?.source ? `source:${ctx.source}` : '',
    ctx?.runId ? `run:${String(ctx.runId).slice(0, 8)}` : '',
    `type:${chartType}`,
    `panels:${panelCount}`
  ]
    .filter(Boolean)
    .join(' · ')
  return {
    filename,
    title,
    subtitle,
    width,
    height,
    chartType,
    panelCount,
    exportedAt: new Date().toISOString()
  }
}
