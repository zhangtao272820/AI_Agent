import type { UnifiedLearningSignal } from '../unifiedLearning'

export type VersionLiftBucket = {
  key: string
  label: string
  sampleCount: number
  avgComposite: number | null
  avgFeedback: number | null
  firstPassRate: number | null
  feedbackCoverage: number | null
}

function avg(nums: number[]): number | null {
  if (!nums.length) return null
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 1000) / 1000
}

function bucketSignals(
  signals: UnifiedLearningSignal[],
  pickKey: (s: UnifiedLearningSignal) => string,
  labelPrefix: string
): VersionLiftBucket[] {
  const map = new Map<string, UnifiedLearningSignal[]>()
  for (const s of signals) {
    const key = pickKey(s)
    if (!key) continue
    const arr = map.get(key) || []
    arr.push(s)
    map.set(key, arr)
  }
  return [...map.entries()]
    .map(([key, rows]) => {
      const composites = rows.map((r) => r.compositeScore).filter((x) => Number.isFinite(x))
      const fb = rows.map((r) => r.feedbackScore).filter((x): x is number => typeof x === 'number' && Number.isFinite(x))
      const firstPass = rows.filter((r) => r.firstPassSuccess).length
      return {
        key,
        label: `${labelPrefix}${key}`,
        sampleCount: rows.length,
        avgComposite: avg(composites),
        avgFeedback: avg(fb),
        firstPassRate: rows.length ? Math.round((firstPass / rows.length) * 1000) / 1000 : null,
        feedbackCoverage: rows.length ? Math.round((fb.length / rows.length) * 1000) / 1000 : null
      }
    })
    .sort((a, b) => b.sampleCount - a.sampleCount)
}

/** 按进化 artifact 版本分桶，供看板观察 promote 是否带来 lift */
export function buildEvolutionVersionLift(signals: UnifiedLearningSignal[]): {
  policy: VersionLiftBucket[]
  promptCanary: VersionLiftBucket[]
  plannerRulesCanary: VersionLiftBucket[]
} {
  const slice = signals.slice(-400)
  return {
    policy: bucketSignals(slice, (s) => (typeof s.policyVersion === 'number' ? `v${s.policyVersion}` : ''), 'policy '),
    promptCanary: bucketSignals(
      slice,
      (s) => (s.promptCanary === true ? 'canary' : s.promptCanary === false ? 'active' : ''),
      'prompt '
    ),
    plannerRulesCanary: bucketSignals(
      slice,
      (s) => (s.plannerRulesCanary === true ? 'canary' : s.plannerRulesCanary === false ? 'active' : ''),
      'planner_rules '
    )
  }
}
