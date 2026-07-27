import path from 'node:path'
import fs from 'node:fs/promises'
import { buildAgentRegistry } from '../../graph/core/agent/agentRegistry'
import { isPolicyCanaryEnabled, policyCanaryPercent } from '../../graph/core/evolution/policyCanary'
import { isVectorMemoryEnabled } from '../../graph/core/memory/vectorMemory'
import { isPromptEvolutionEnabled } from '../../graph/core/evolution/promptEvolution'
import { isPlannerRulesEnabled } from '../../graph/core/evolution/plannerRules'
import { isPlannerRuleEvolutionEnabled } from '../../graph/core/evolution/plannerRuleEvolution'
import { isLayeredMemoryEnabled, isReflectionMemoryEnabled, isSemanticMemoryEnabled } from '../../graph/core/layeredMemory'
import { isEvolutionAutoExperimentEnabled } from '../../graph/core/evolution/evolutionExperiments'
import { isUnifiedLearningEnabled } from '../../graph/core/unifiedLearning'
import { isProactiveLoopEnabled } from '../../graph/core/task/proactiveLoop'
import { isUserGoalsEnabled } from '../../graph/core/task/userGoals'
import { isTaskStackAutoIngestEnabled } from '../../graph/core/task/taskStackIngest'
import { isAutonomousRunEnabled } from '../../graph/core/task/autonomousQueue'
import { isRouteStrategyEnabled } from '../../graph/core/routing/routeStrategy'
import { isTaskStackAutoCompleteEnabled } from '../../graph/core/task/taskStackFinalize'
import { isAutonomousWsNotifyEnabled } from '../../graph/core/task/autonomousNotify'
import { isRoutePreferenceLearnEnabled } from '../../graph/core/routing/routePreferences'
import { isTaskStackRouterExtractEnabled } from '../../graph/core/task/taskStackIngest'
import { isWorldModelEnabled } from '../../graph/core/task/worldModel'
import { isAdminWriteGateEnabled } from '../../graph/core/db/writeGate'
import { isEvolutionLlmHypothesisEnabled } from '../../graph/core/evolution/evolutionLlmHypothesis'
import { isImplicitLearningEnabled } from '../../graph/core/evolution/implicitLearning'
import { isSharedTaskStackEnabled } from '../../graph/core/task/sharedTaskStack'
import { isRouteBanditEnabled } from '../../graph/core/routing/routeBandit'
import { isPredictiveWorldModelEnabled } from '../../graph/core/task/worldModel'
import { isTaskStackFinalizeLlmExtractEnabled } from '../../graph/core/task/taskStackLlmExtract'
import { isRoutePolicyRlEnabled } from '../../graph/core/routing/routePolicyRl'
import { isRouteCausalEnabled } from '../../graph/core/routing/routeCausal'
import { isAutonomousReplanEnabled, isAutonomousDecomposeEnabled } from '../../graph/core/task/autonomousPlan'

export default defineEventHandler(async () => {
  const policyDir = path.join(process.cwd(), '.data')
  const registry = buildAgentRegistry()
  let toolHealth: unknown = null
  try {
    const raw = await fs.readFile(path.join(policyDir, 'manager-tool-health.json'), 'utf8')
    toolHealth = JSON.parse(raw)
  } catch {}

  return {
    ok: true,
    registry,
    toolHealth,
    evolution: {
      vectorMemory: isVectorMemoryEnabled(),
      layeredMemory: isLayeredMemoryEnabled(),
      memoryReflect: isReflectionMemoryEnabled(),
      memorySemantic: isSemanticMemoryEnabled(),
      promptEvolve: isPromptEvolutionEnabled(),
      plannerRules: isPlannerRulesEnabled(),
      plannerRuleEvolve: isPlannerRuleEvolutionEnabled(),
      evolutionCuratorLegacy:
        String(process.env.MANAGER_EVOLUTION_CURATOR ?? '1').trim() !== '0' &&
        String(process.env.MANAGER_AUTONOMY_PLUGIN ?? '1').trim() === '0',
      evolutionAutoExperiment: isEvolutionAutoExperimentEnabled(),
      unifiedLearning: isUnifiedLearningEnabled(),
      proactiveLoop: isProactiveLoopEnabled(),
      userGoals: isUserGoalsEnabled(),
      taskStackAutoIngest: isTaskStackAutoIngestEnabled(),
      taskStackRouterExtract: isTaskStackRouterExtractEnabled(),
      taskStackAutoComplete: isTaskStackAutoCompleteEnabled(),
      autonomousWsNotify: isAutonomousWsNotifyEnabled(),
      routePreferenceLearn: isRoutePreferenceLearnEnabled(),
      routeStrategy: isRouteStrategyEnabled(),
      worldModel: isWorldModelEnabled(),
      adminWriteGate: isAdminWriteGateEnabled(),
      evolutionLlmHypothesis: isEvolutionLlmHypothesisEnabled(),
      implicitLearning: isImplicitLearningEnabled(),
      sharedTaskStack: isSharedTaskStackEnabled(),
      routeBandit: isRouteBanditEnabled(),
      routePolicyRl: isRoutePolicyRlEnabled(),
      routeCausal: isRouteCausalEnabled(),
      predictiveWorldModel: isPredictiveWorldModelEnabled(),
      taskStackFinalizeLlmExtract: isTaskStackFinalizeLlmExtractEnabled(),
      autonomousRun: isAutonomousRunEnabled(),
      autonomousReplan: isAutonomousReplanEnabled(),
      autonomousDecompose: isAutonomousDecomposeEnabled(),
      learningWeightTune: String(process.env.MANAGER_LEARNING_WEIGHT_TUNE ?? '1').trim() !== '0',
      autonomyPlugin: String(process.env.MANAGER_AUTONOMY_PLUGIN ?? '1').trim() !== '0',
      policyCanaryPercent: policyCanaryPercent(),
      policyCanaryEnabled: isPolicyCanaryEnabled()
    }
  }
})
