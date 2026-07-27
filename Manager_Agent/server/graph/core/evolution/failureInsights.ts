import fs from 'node:fs/promises'
import path from 'node:path'
import { readHistoryEntries } from '../shared'
import { attributeFailure } from './failureAttribution'
import { buildFixSuggestions, type FixSuggestionBundle } from './failureFixSuggestions'
import { readSignals } from '../unifiedLearning'

export type FailureInsight = {
  category: string
  count: number
  avgSuccessScore: number
  avgRouteConfidence: number
  avgFinalConfidence: number
  topReasons: string[]
  lastTs?: string
}

export type FailureInsightBundle = {
  samples: number
  failures: FailureInsight[]
  strongestSignals: string[]
  fixSuggestions?: FixSuggestionBundle[]
}

function normalizeCategory(v: unknown) {
  const s = String(v ?? '').trim()
  return s || 'unclear'
}

function scoreOf(v: unknown) {
  const n = Number(v)
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0
}

function pushReason(map: Map<string, number>, reason: unknown) {
  const s = String(reason ?? '').trim()
  if (!s) return
  map.set(s, (map.get(s) || 0) + 1)
}

export async function analyzeFailureInsights(policyDir: string): Promise<FailureInsightBundle> {
  const jsonl = path.join(policyDir, 'manager-memory.jsonl')
  const json = path.join(policyDir, 'manager-memory.json')
  const history = await readHistoryEntries(jsonl, json, 800)
  const exps = (Array.isArray(history) ? history : []).filter((h) => h?.type === 'experience')
  const failureSamples = exps.filter((e) => normalizeCategory(e?.failureCategory) !== 'success' || scoreOf(e?.successScore) < 0.75)
  if (!failureSamples.length) {
    return { samples: 0, failures: [], strongestSignals: [] }
  }

  const byCat = new Map<string, { count: number; successSum: number; routeSum: number; finalSum: number; reasons: Map<string, number>; lastTs?: string }>()
  for (const e of failureSamples) {
    const cat = normalizeCategory(e?.failureCategory)
    const prev = byCat.get(cat) || { count: 0, successSum: 0, routeSum: 0, finalSum: 0, reasons: new Map<string, number>(), lastTs: undefined }
    prev.count += 1
    prev.successSum += scoreOf(e?.successScore)
    prev.routeSum += scoreOf(e?.routeConfidence)
    prev.finalSum += scoreOf(e?.finalConfidence)
    if (Array.isArray(e?.failureReasons)) {
      for (const r of e.failureReasons.slice(0, 6)) pushReason(prev.reasons, r)
    }
    if (typeof e?.ts === 'string') prev.lastTs = e.ts
    byCat.set(cat, prev)
  }

  const failures: FailureInsight[] = Array.from(byCat.entries())
    .map(([category, v]) => ({
      category,
      count: v.count,
      avgSuccessScore: v.successSum / v.count,
      avgRouteConfidence: v.routeSum / v.count,
      avgFinalConfidence: v.finalSum / v.count,
      topReasons: Array.from(v.reasons.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([reason]) => reason),
      lastTs: v.lastTs
    }))
    .sort((a, b) => b.count - a.count)

  let strongestSignals = failures.slice(0, 4).map((f) => `${f.category}(${f.count})`)
  const searchGap = failures.find((f) => f.category === 'search_gap')
  if (searchGap && searchGap.count >= 2 && !strongestSignals.some((s) => s.startsWith('search_gap'))) {
    strongestSignals = [`search_gap(${searchGap.count})`, ...strongestSignals].slice(0, 5)
  }
  const learningSignals = await readSignals(policyDir, 120).catch(() => [])
  const searchRuns = learningSignals.filter((s) => s.searchRequested)
  const searchFails = searchRuns.filter((s) => s.searchFailed || (s.searchHitCount ?? 0) === 0)
  if (searchRuns.length >= 3 && searchFails.length >= 2) {
    const hint = `联网零命中 ${searchFails.length}/${searchRuns.length}`
    if (!strongestSignals.includes(hint)) strongestSignals = [hint, ...strongestSignals].slice(0, 5)
  }
  const fixSuggestions: FixSuggestionBundle[] = failureSamples
    .slice(0, 12)
    .map((sample) => buildFixSuggestions(attributeFailure(sample), {
      routeConfidence: Number(sample?.routeConfidence ?? 0),
      finalConfidence: Number(sample?.finalConfidence ?? 0),
      hasEvidence: Array.isArray(sample?.path) ? sample.path.length > 0 : false,
      toolNames: Array.isArray(sample?.path) ? sample.path.map((x: any) => String(x ?? '')) : []
    }))
  return { samples: failureSamples.length, failures, strongestSignals, fixSuggestions }
}

export async function appendFailureInsightSnapshot(policyDir: string, bundle: FailureInsightBundle) {
  try {
    const dir = path.join(policyDir)
    await fs.mkdir(dir, { recursive: true }).catch(() => undefined)
    const p = path.join(dir, 'manager-failure-insights.json')
    await fs.writeFile(
      p,
      JSON.stringify(
        {
          updatedAt: new Date().toISOString(),
          ...bundle
        },
        null,
        2
      ),
      'utf8'
    )
  } catch {}
}
