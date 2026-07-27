/**
 * P2-4：内置 Agent 下游质量埋点（clean / chart / report）。
 * 写入 manager-metrics.jsonl，phase 前缀 downstream:*。
 */

import fs from 'node:fs/promises'
import path from 'node:path'

async function appendMetricsLine(entry: Record<string, unknown>): Promise<void> {
  const dir = path.join(process.cwd(), '.data')
  await fs.mkdir(dir, { recursive: true }).catch(() => undefined)
  const p = path.join(dir, 'manager-metrics.jsonl')
  await fs.appendFile(p, `${JSON.stringify({ ...entry, ts: new Date().toISOString() })}\n`, 'utf8')
}

export type DownstreamMetricKind = 'clean' | 'chart' | 'report'

export type DownstreamMetricInput = {
  runId?: string
  kind: DownstreamMetricKind
  ok: boolean
  mode?: string
  reason?: string
  /** report evidence 覆盖率 0–1 */
  evidenceCoverage?: number
  /** chart 是否首次组装即通过 validator */
  firstPass?: boolean
  ms?: number
}

export function isDownstreamMetricsEnabled(): boolean {
  return String(process.env.MANAGER_DOWNSTREAM_METRICS ?? '1').trim() !== '0'
}

export async function recordDownstreamMetric(input: DownstreamMetricInput): Promise<void> {
  if (!isDownstreamMetricsEnabled()) return
  const runId = String(input.runId ?? '').trim() || 'unknown'
  const phase = `downstream:${input.kind}`
  await appendMetricsLine({
    runId,
    phase,
    ms: Math.max(0, Number(input.ms ?? 0)),
    ok: Boolean(input.ok),
    mode: input.mode,
    reason: input.reason,
    evidenceCoverage:
      typeof input.evidenceCoverage === 'number' && Number.isFinite(input.evidenceCoverage)
        ? Math.round(input.evidenceCoverage * 1000) / 1000
        : undefined,
    firstPass: input.firstPass,
    agent: input.kind
  }).catch(() => undefined)
}

export type DownstreamMetricRow = {
  kind?: DownstreamMetricKind
  ok?: boolean
  mode?: string
  reason?: string
  evidenceCoverage?: number
  firstPass?: boolean
  ts?: string
}

export function aggregateDownstreamMetrics(rows: Array<Record<string, unknown>>): {
  clean: { total: number; ok: number; rate: number | null }
  chart: { total: number; ok: number; firstPass: number; rate: number | null; firstPassRate: number | null }
  report: { total: number; ok: number; avgEvidenceCoverage: number | null; rate: number | null }
} {
  const init = () => ({ total: 0, ok: 0, firstPass: 0, evidenceSum: 0, evidenceCount: 0 })
  const acc = { clean: init(), chart: init(), report: init() }

  for (const rec of rows) {
    const phase = String(rec?.phase ?? '')
    if (!phase.startsWith('downstream:')) continue
    const kind = phase.slice('downstream:'.length) as DownstreamMetricKind
    if (kind !== 'clean' && kind !== 'chart' && kind !== 'report') continue
    const bucket = acc[kind]
    bucket.total += 1
    const extra = rec?.extra && typeof rec.extra === 'object' ? (rec.extra as Record<string, unknown>) : rec
    if (Boolean(extra?.ok ?? rec?.ok)) bucket.ok += 1
    if (kind === 'chart' && Boolean(extra?.firstPass ?? rec?.firstPass)) bucket.firstPass += 1
    const cov = Number(extra?.evidenceCoverage ?? rec?.evidenceCoverage)
    if (kind === 'report' && Number.isFinite(cov)) {
      bucket.evidenceSum += cov
      bucket.evidenceCount += 1
    }
  }

  const rate = (total: number, ok: number) => (total ? Math.round((ok / total) * 1000) / 1000 : null)

  return {
    clean: { total: acc.clean.total, ok: acc.clean.ok, rate: rate(acc.clean.total, acc.clean.ok) },
    chart: {
      total: acc.chart.total,
      ok: acc.chart.ok,
      firstPass: acc.chart.firstPass,
      rate: rate(acc.chart.total, acc.chart.ok),
      firstPassRate: rate(acc.chart.total, acc.chart.firstPass)
    },
    report: {
      total: acc.report.total,
      ok: acc.report.ok,
      avgEvidenceCoverage: acc.report.evidenceCount
        ? Math.round((acc.report.evidenceSum / acc.report.evidenceCount) * 1000) / 1000
        : null,
      rate: rate(acc.report.total, acc.report.ok)
    }
  }
}
