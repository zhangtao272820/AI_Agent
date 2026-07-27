import path from 'node:path'
import { maybeCurateManagerMemory } from '../graph/core/memory/memoryCurator'
import { analyzeFailureInsights } from '../graph/core/evolution/failureInsights'
import { runEvolutionExperimentCycle } from '../graph/core/evolution/evolutionExperiments'

export function isEvolutionCuratorEnabled() {
  return String(process.env.MANAGER_EVOLUTION_CURATOR ?? '1').trim() !== '0'
}

function curatorIntervalMs() {
  const n = Number(process.env.MANAGER_EVOLUTION_CURATOR_INTERVAL_MS ?? 600_000)
  return Number.isFinite(n) && n >= 120_000 ? Math.min(3_600_000, Math.floor(n)) : 600_000
}

/**
 * @deprecated 请使用 managerAutonomyPlugin；保留兼容：MANAGER_EVOLUTION_CURATOR=1 时仍加载本插件
 */
export default defineNitroPlugin(() => {
  if (!isEvolutionCuratorEnabled()) return
  if (String(process.env.MANAGER_AUTONOMY_PLUGIN ?? '1').trim() !== '0') return

  const policyDir = path.join(process.cwd(), '.data')
  let running = false

  const tick = async () => {
    if (running) return
    running = true
    try {
      await maybeCurateManagerMemory(policyDir).catch(() => undefined)
      const insights = await analyzeFailureInsights(policyDir).catch(() => ({
        samples: 0,
        failures: [],
        strongestSignals: [],
        fixSuggestions: []
      }))
      if (insights.samples > 0) {
        await runEvolutionExperimentCycle(policyDir, insights, { force: false }).catch(() => undefined)
      }
    } finally {
      running = false
    }
  }

  const ms = curatorIntervalMs()
  setTimeout(() => tick().catch(() => undefined), 15_000)
  setInterval(() => tick().catch(() => undefined), ms)
})
