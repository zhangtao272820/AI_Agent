import fs from 'node:fs/promises'
import path from 'node:path'
import { buildEvolutionVersionLift } from '../evolution/evolutionVersionLift'
import { isImplicitLearningEnabled } from '../evolution/implicitLearning'
import {
  type UnifiedLearningSignal,
  computeCompositeScore,
  isUnifiedLearningEnabled,
  isLearningWeightTuneEnabled,
  getEffectiveLearningWeights,
  getCachedLearningWeights,
  refreshLearningWeightsCache,
  normalizeWeights,
  persistLearningWeights,
  maxSignalLines,
  recordRouteLearningExtensions,
  clamp01,
  SIGNAL_FILE
} from './record'
import { shouldRecordRouteBanditReward, recordBanditReward } from '../routing/routeBandit'

function searchSignalsSummary(signals: UnifiedLearningSignal[]) {
  const requested = signals.filter((s) => s.searchRequested)
  if (!requested.length) return null
  const hits = requested.filter((s) => (s.searchHitCount ?? 0) > 0)
  const failed = requested.filter((s) => s.searchFailed || (s.searchHitCount ?? 0) === 0)
  return {
    runsWithSearch: requested.length,
    hitRate: Math.round((hits.length / requested.length) * 1000) / 1000,
    zeroHitRate: Math.round((failed.length / requested.length) * 1000) / 1000,
    avgHits:
      hits.length > 0
        ? Math.round((hits.reduce((a, s) => a + (s.searchHitCount ?? 0), 0) / hits.length) * 10) / 10
        : null
  }
}

export async function readSignals(policyDir: string, maxLines = 500): Promise<UnifiedLearningSignal[]> {
  const p = path.join(policyDir, SIGNAL_FILE)
  const raw = await fs.readFile(p, 'utf8').catch(() => '')
  if (!raw.trim()) return []
  const lines = raw.split('\n').filter((l) => l.trim()).slice(-maxLines)
  const out: UnifiedLearningSignal[] = []
  for (const line of lines) {
    try {
      out.push(JSON.parse(line) as UnifiedLearningSignal)
    } catch {}
  }
  return out
}

export async function buildUnifiedLearningDashboard(policyDir: string, sessionId?: string) {
  const effectiveWeights = await getEffectiveLearningWeights(policyDir).catch(() => getCachedLearningWeights())
  const signals = await readSignals(policyDir, 400)
  const filtered = sessionId ? signals.filter((s) => s.sessionId === sessionId) : signals
  const slice = filtered.length ? filtered : signals
  if (!slice.length) {
    return {
      enabled: isUnifiedLearningEnabled(),
      sampleCount: 0,
      avgComposite: null as number | null,
      weights: effectiveWeights,
      weightTuneEnabled: isLearningWeightTuneEnabled()
    }
  }
  const composites = slice.map((s) => s.compositeScore).filter((x) => Number.isFinite(x))
  const avg = composites.length ? composites.reduce((a, b) => a + b, 0) / composites.length : null
  const withFb = slice.filter((s) => typeof s.feedbackScore === 'number').length
  const implicitCount = slice.filter((s) => s.signalSource === 'implicit' || s.implicitKind).length
  const fbScores = slice
    .map((s) => s.feedbackScore)
    .filter((x): x is number => typeof x === 'number' && Number.isFinite(x))
  const avgFeedback = fbScores.length ? fbScores.reduce((a, b) => a + b, 0) / fbScores.length : null
  const recent = slice.slice(-8).reverse()
  const chartPoints = slice.slice(-20).map((s, i) => ({
    i: i + 1,
    composite: s.compositeScore,
    feedback: typeof s.feedbackScore === 'number' ? s.feedbackScore : null,
    intent: s.intent,
    implicit: s.signalSource === 'implicit' || Boolean(s.implicitKind)
  }))
  return {
    enabled: isUnifiedLearningEnabled(),
    implicitLearningEnabled: isImplicitLearningEnabled(),
    sampleCount: slice.length,
    avgComposite: avg != null ? Math.round(avg * 1000) / 1000 : null,
    avgFeedback: avgFeedback != null ? Math.round(avgFeedback * 1000) / 1000 : null,
    feedbackCoverage: slice.length ? Math.round((withFb / slice.length) * 1000) / 1000 : null,
    implicitSignalRatio: slice.length ? Math.round((implicitCount / slice.length) * 1000) / 1000 : null,
    searchMetrics: searchSignalsSummary(slice),
    versionLift: buildEvolutionVersionLift(slice),
    weights: effectiveWeights,
    weightTuneEnabled: isLearningWeightTuneEnabled(),
    recent,
    chartPoints
  }
}

export async function patchLearningSignalWithFeedback(
  policyDir: string,
  runId: string,
  feedbackScore: number
): Promise<{ patched: boolean; compositeScore?: number }> {
  if (!isUnifiedLearningEnabled()) return { patched: false }
  await refreshLearningWeightsCache(policyDir).catch(() => undefined)
  const p = path.join(policyDir, SIGNAL_FILE)
  const raw = await fs.readFile(p, 'utf8').catch(() => '')
  if (!raw.trim()) return { patched: false }
  const lines = raw.split('\n').filter((l) => l.trim())
  let patched = false
  let compositeScore: number | undefined
  const next = lines.map((line) => {
    try {
      const o = JSON.parse(line) as UnifiedLearningSignal
      if (String(o.runId || '') !== runId) return line
      patched = true
      const fb = clamp01(feedbackScore)
      compositeScore = computeCompositeScore({
        finalConfidence: o.finalConfidence,
        routeConfidence: o.routeConfidence,
        successScore: o.successScore,
        feedbackScore: fb,
        durationMs: o.durationMs,
        firstPassSuccess: o.firstPassSuccess
      })
      return JSON.stringify({
        ...o,
        feedbackScore: fb,
        compositeScore,
        signalSource: 'explicit_feedback',
        ts: new Date().toISOString()
      })
    } catch {
      return line
    }
  })
  if (patched) {
    await fs.writeFile(p, `${next.join('\n')}\n`, 'utf8')
    if (compositeScore != null) {
      const row = next
        .map((line) => {
          try {
            return JSON.parse(line) as UnifiedLearningSignal
          } catch {
            return null
          }
        })
        .find((o) => o && String(o.runId || '') === runId)
      if (row) {
        await recordRouteLearningExtensions(policyDir, row).catch(() => undefined)
        if (shouldRecordRouteBanditReward(row)) {
          await recordBanditReward(policyDir, row.intent, compositeScore).catch(() => undefined)
        }
      }
    }
  }
  return { patched, compositeScore }
}

export async function maybeTuneLearningWeights(
  policyDir: string
): Promise<{ tuned: boolean; weights?: import('./record').LearningWeights }> {
  if (!isUnifiedLearningEnabled() || !isLearningWeightTuneEnabled()) return { tuned: false }
  const signals = await readSignals(policyDir, 120)
  const withFb = signals.filter((s) => typeof s.feedbackScore === 'number')
  const minSamples = Number(process.env.MANAGER_LEARNING_TUNE_MIN_SAMPLES ?? 12)
  if (withFb.length < (Number.isFinite(minSamples) ? minSamples : 12)) return { tuned: false }

  const avgFb = withFb.reduce((a, s) => a + (s.feedbackScore ?? 0), 0) / withFb.length
  const avgComp = withFb.reduce((a, s) => a + s.compositeScore, 0) / withFb.length
  const current = await getEffectiveLearningWeights(policyDir)
  const next = { ...current }
  let reason = 'stable'

  if (avgFb < 0.45 || avgComp < 0.5) {
    next.feedback = Math.min(0.45, next.feedback + 0.04)
    next.success = Math.max(0.2, next.success - 0.02)
    reason = 'low_satisfaction_boost_feedback'
  } else if (avgFb > 0.75 && avgComp > 0.72) {
    next.final = Math.min(0.42, next.final + 0.02)
    next.feedback = Math.max(0.12, next.feedback - 0.02)
    reason = 'high_satisfaction_balance_quality'
  } else {
    return { tuned: false, weights: current }
  }

  const normalized = normalizeWeights({
    ...next,
    tunedAt: new Date().toISOString(),
    reason
  })
  await persistLearningWeights(policyDir, normalized)
  return { tuned: true, weights: normalized }
}

export async function maybeTrimLearningSignals(policyDir: string): Promise<{ trimmed: number }> {
  if (!isUnifiedLearningEnabled()) return { trimmed: 0 }
  const p = path.join(policyDir, SIGNAL_FILE)
  const raw = await fs.readFile(p, 'utf8').catch(() => '')
  if (!raw.trim()) return { trimmed: 0 }
  const lines = raw.split('\n').filter((l) => l.trim())
  const max = maxSignalLines()
  if (lines.length <= max) return { trimmed: 0 }
  const kept = lines.slice(-max)
  await fs.writeFile(p, `${kept.join('\n')}\n`, 'utf8')
  return { trimmed: lines.length - kept.length }
}

export async function lowScoreRunsForSession(policyDir: string, sessionId: string, limit = 3) {
  const signals = await readSignals(policyDir, 200)
  return signals
    .filter((s) => s.sessionId === sessionId && s.compositeScore < 0.55)
    .slice(-limit)
    .reverse()
}
