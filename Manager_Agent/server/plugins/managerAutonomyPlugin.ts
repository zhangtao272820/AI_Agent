import path from 'node:path'
import { maybeCurateManagerMemory } from '../graph/core/memory/memoryCurator'
import { analyzeFailureInsights } from '../graph/core/evolution/failureInsights'
import { runEvolutionExperimentCycle } from '../graph/core/evolution/evolutionExperiments'
import { runProactiveLoopTick, isProactiveLoopEnabled } from '../graph/core/task/proactiveLoop'
import { isAutonomousRunEnabled, processAutonomousQueueTick } from '../graph/core/task/autonomousQueue'
import { executeHeadlessManagerRun } from '../graph/core/runtime/headlessRun'
import { isRoutePreferenceLearnEnabled, maybeRefreshRoutePreferences } from '../graph/core/routing/routePreferences'
import { maybeTrimLearningSignals, isUnifiedLearningEnabled, maybeTuneLearningWeights } from '../graph/core/unifiedLearning'
import { isRouteCausalEnabled, maybeRefreshRouteCausalGraph } from '../graph/core/routing/routeCausal'
import { evoAuditIntervalMs, isEvoAuditJobEnabled } from '#agent-shared/evoAuditJob'
import { runEvolutionHubAudit } from '../utils/platform/evolutionHub'
import { runSessionArchiveJob, isSessionArchiveEnabled } from '#agent-shared/sessionArchiveJob'
import { runSemanticConsolidationJob, isSemanticConsolidationEnabled } from '#agent-shared/semanticConsolidationJob'
import { runMemoryFoldJob, isMemoryFoldEnabled } from '#agent-shared/memoryFoldJob'
import { runPgDailyBackup, isPgDailyBackupEnabled } from '#agent-shared/pgDailyBackupJob'

function autonomyEnabled() {
  return String(process.env.MANAGER_AUTONOMY_PLUGIN ?? '1').trim() !== '0'
}

function tickIntervalMs() {
  const n = Number(process.env.MANAGER_AUTONOMY_TICK_MS ?? 600_000)
  return Number.isFinite(n) && n >= 120_000 ? Math.min(3_600_000, Math.floor(n)) : 600_000
}

/**
 * 后台自治循环：记忆治理 + 进化实验 + 主动推进扫描 + 学习信号修剪
 * 默认开启（MANAGER_AUTONOMY_PLUGIN=1）；进化 Curator 单独开关已合并到此插件。
 */
export default defineNitroPlugin(() => {
  if (!autonomyEnabled()) return

  const policyDir = path.join(process.cwd(), '.data')
  let running = false
  let lastEvoAuditAt = 0
  let lastArchiveAt = 0
  let lastSemanticAt = 0
  let lastFoldAt = 0
  let lastBackupAt = 0

  const tick = async () => {
    if (running) return
    running = true
    try {
      await maybeCurateManagerMemory(policyDir).catch(() => undefined)
      if (isUnifiedLearningEnabled()) {
        await maybeTrimLearningSignals(policyDir).catch(() => undefined)
        await maybeTuneLearningWeights(policyDir).catch(() => undefined)
        if (isRoutePreferenceLearnEnabled()) {
          await maybeRefreshRoutePreferences(policyDir).catch(() => undefined)
        }
        if (isRouteCausalEnabled()) {
          await maybeRefreshRouteCausalGraph(policyDir).catch(() => undefined)
        }
      }
      const insights = await analyzeFailureInsights(policyDir).catch(() => ({
        samples: 0,
        failures: [],
        strongestSignals: [],
        fixSuggestions: []
      }))
      if (insights.samples > 0) {
        await runEvolutionExperimentCycle(policyDir, insights, { force: false }).catch(() => undefined)
      }
      if (isProactiveLoopEnabled()) {
        await runProactiveLoopTick(policyDir).catch(() => undefined)
      }
      if (isAutonomousRunEnabled()) {
        await processAutonomousQueueTick(policyDir, executeHeadlessManagerRun).catch(() => undefined)
      }
      if (isEvoAuditJobEnabled() && Date.now() - lastEvoAuditAt >= evoAuditIntervalMs()) {
        lastEvoAuditAt = Date.now()
        await runEvolutionHubAudit().catch(() => undefined)
      }
      if (isSessionArchiveEnabled() && Date.now() - lastArchiveAt >= 86_400_000) {
        lastArchiveAt = Date.now()
        await runSessionArchiveJob().catch(() => undefined)
      }
      if (isSemanticConsolidationEnabled() && Date.now() - lastSemanticAt >= 86_400_000) {
        lastSemanticAt = Date.now()
        await runSemanticConsolidationJob().catch(() => undefined)
      }
      if (isMemoryFoldEnabled() && Date.now() - lastFoldAt >= 86_400_000) {
        lastFoldAt = Date.now()
        await runMemoryFoldJob().catch(() => undefined)
      }
      if (isPgDailyBackupEnabled() && Date.now() - lastBackupAt >= 86_400_000) {
        lastBackupAt = Date.now()
        await runPgDailyBackup().catch(() => undefined)
      }
    } finally {
      running = false
    }
  }

  const ms = tickIntervalMs()
  setTimeout(() => tick().catch(() => undefined), 20_000)
  setInterval(() => tick().catch(() => undefined), ms)
})
