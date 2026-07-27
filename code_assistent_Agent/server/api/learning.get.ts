import { getLearningSummary, getRoutePreferences } from '../utils/code_learning'
import { getCodeQueryMetricCounters, readRecentCodeMetrics } from '../utils/code_metrics'
import { getExperienceVectorSummary } from '../utils/code_experience_vectors'
import { getPromptEvolutionSummary } from '../utils/code_prompt_evolution'
import { getCrossAgentMemorySummary } from '../utils/code_cross_agent_memory'
import { getPromptAbSummary } from '../utils/code_prompt_ab_router'
import { listEvolvedHints } from '../utils/code_evolved_config'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export default defineEventHandler(async () => {
  const prefs = getRoutePreferences()
  let evalBaseline: { passRate?: number; at?: string } | null = null
  const evalFile = join(process.cwd(), '.data', 'code-smoke-baseline.json')
  if (existsSync(evalFile)) {
    try {
      const o = JSON.parse(readFileSync(evalFile, 'utf8'))
      evalBaseline = { passRate: o?.passRate, at: o?.at }
    } catch {
      evalBaseline = null
    }
  }
  return {
    ok: true,
    learning: getLearningSummary(),
    experience: getExperienceVectorSummary(),
    promptEvolution: getPromptEvolutionSummary(),
    evolvedHints: listEvolvedHints().slice(-8),
    crossAgent: getCrossAgentMemorySummary(),
    promptAb: getPromptAbSummary(),
    evalBaseline,
    preferences: {
      boostedFiles: Object.keys(prefs.fileBoosts).slice(0, 12),
      penalizedFiles: Object.keys(prefs.filePenalties).slice(0, 8),
      taskKindStats: prefs.taskKindStats,
    },
    metrics: {
      counters: getCodeQueryMetricCounters(),
      recent: readRecentCodeMetrics(20),
    },
  }
})
