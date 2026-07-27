/**
 * 语义升华：同 scenario 多条高分 experience → 1 条 semantic fact（MUSE 式 Process/Strategic 雏形）
 */

import { agentPgQuery } from './agentPgClient'
import { AMP_EXPERIENCE_SUCCESS_THRESHOLD } from './agentMemoryPolicy'
import { recordMemory } from './agentMemoryApi'

export function isSemanticConsolidationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.MGR_SEMANTIC_CONSOLIDATION_JOB ?? '1').trim() !== '0'
}

function minClusterSize(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.MGR_SEMANTIC_CONSOLIDATION_MIN_CLUSTER ?? 3)
  return Number.isFinite(n) && n >= 2 ? Math.min(10, Math.floor(n)) : 3
}

type ExperienceRow = { payload: Record<string, unknown> }

function scenarioKey(payload: Record<string, unknown>): string {
  return String(payload.scenarioKey || payload.scenario_key || 'general').slice(0, 120)
}

function intentOf(payload: Record<string, unknown>): string {
  return String(payload.intent || payload.userSummary || payload.question || '').slice(0, 200)
}

function successScore(payload: Record<string, unknown>): number {
  const n = Number(payload.successScore ?? payload.success_score)
  return Number.isFinite(n) ? n : 0
}

export async function runSemanticConsolidationJob(env: NodeJS.ProcessEnv = process.env): Promise<{
  scanned: number
  consolidated: number
  skipped: number
}> {
  if (!isSemanticConsolidationEnabled(env)) {
    return { scanned: 0, consolidated: 0, skipped: 0 }
  }

  const threshold = AMP_EXPERIENCE_SUCCESS_THRESHOLD
  const res = await agentPgQuery<ExperienceRow>(
    `SELECT payload FROM mgr_memory_entries
     WHERE entry_type = 'experience'
       AND COALESCE((payload->>'successScore')::float, (payload->>'success_score')::float, 0) >= $1
     ORDER BY ts DESC
     LIMIT 800`,
    [threshold],
    env
  )
  const rows = res?.rows ?? []
  const byScenario = new Map<string, ExperienceRow[]>()
  for (const row of rows) {
    const key = scenarioKey(row.payload)
    const list = byScenario.get(key) ?? []
    list.push(row)
    byScenario.set(key, list)
  }

  const existing = await agentPgQuery<{ scenario: string }>(
    `SELECT DISTINCT payload->>'scenarioKey' AS scenario
     FROM mgr_memory_entries
     WHERE entry_type = 'semantic'`,
    [],
    env
  )
  const hasSemantic = new Set((existing?.rows ?? []).map((r) => String(r.scenario || '')))

  let consolidated = 0
  let skipped = 0
  const minCluster = minClusterSize(env)

  for (const [scenario, cluster] of byScenario) {
    if (cluster.length < minCluster) {
      skipped += 1
      continue
    }
    if (hasSemantic.has(scenario)) {
      skipped += 1
      continue
    }

    const intents = cluster.map((r) => intentOf(r.payload)).filter(Boolean)
    const uniqueIntents = [...new Set(intents)].slice(0, 5)
    const fact = `场景「${scenario}」已验证 ${cluster.length} 次成功路径；常见意图：${uniqueIntents.join('；')}`
    const confidence = Math.min(0.95, 0.55 + cluster.length * 0.08)

    await recordMemory(
      {
        type: 'semantic',
        agent: 'manager',
        successScore: confidence,
        payload: {
          scenarioKey: scenario,
          intent: uniqueIntents[0] || scenario,
          fact,
          confidence,
          source: 'semantic_consolidation_job',
          clusterSize: cluster.length
        }
      },
      env
    )
    hasSemantic.add(scenario)
    consolidated += 1
  }

  return { scanned: rows.length, consolidated, skipped }
}
