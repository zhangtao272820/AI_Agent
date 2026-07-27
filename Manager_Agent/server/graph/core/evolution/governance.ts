import fs from 'node:fs/promises'
import path from 'node:path'
import { readHistoryEntries } from '../shared'
import { evaluateShadowPromotion } from './autoEvolution'
import type { FailureInsightBundle } from './failureInsights'

export type GovernanceSnapshot = {
  updatedAt: string
  policyVersion?: number
  activeSamples: number
  failureConcentration: number
  canPromote: boolean
  confidence: number
  reasons: string[]
  recommendedActions: string[]
}

function avg(nums: number[]) {
  if (!nums.length) return 0
  return nums.reduce((a, b) => a + b, 0) / nums.length
}

export async function buildGovernanceSnapshot(policyDir: string, insights: FailureInsightBundle): Promise<GovernanceSnapshot> {
  const jsonl = path.join(policyDir, 'manager-nlu-metrics.jsonl')
  const json = path.join(policyDir, 'manager-nlu-metrics.json')
  const metrics = await readHistoryEntries(jsonl, json, 260)
  const finals = metrics.map((m) => Number(m?.finalConfidence)).filter((x) => Number.isFinite(x))
  const route = metrics.map((m) => Number(m?.routeConfidence)).filter((x) => Number.isFinite(x))
  const activeSamples = metrics.length
  const failureConcentration = insights.failures.length ? Math.max(...insights.failures.map((f) => f.count)) / Math.max(1, insights.samples) : 0
  const evalResult = evaluateShadowPromotion(insights, { recentSamples: activeSamples, baselineSampleCount: finals.length, failureConcentration })
  const recommendedActions = [] as string[]
  if (avg(finals) < 0.68) recommendedActions.push('prioritize_synth_and_verifier')
  if (avg(route) < 0.62) recommendedActions.push('prioritize_router_recall')
  if (failureConcentration > 0.4) recommendedActions.push('focus_top_failure_cluster')
  if (evalResult.eligible) recommendedActions.push('shadow_candidate_can_promote')
  return {
    updatedAt: new Date().toISOString(),
    activeSamples,
    failureConcentration,
    canPromote: evalResult.eligible,
    confidence: evalResult.confidence,
    reasons: evalResult.reasons,
    recommendedActions
  }
}

export async function writeGovernanceSnapshot(policyDir: string, snapshot: GovernanceSnapshot) {
  const p = path.join(policyDir, 'manager-governance.json')
  await fs.mkdir(policyDir, { recursive: true }).catch(() => undefined)
  await fs.writeFile(p, JSON.stringify(snapshot, null, 2), 'utf8')
}
