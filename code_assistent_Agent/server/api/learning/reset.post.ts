import { clearLearningData, clearRoutePreferences } from '../../utils/code_learning'
import { clearExperienceVectors } from '../../utils/code_experience_vectors'
import { clearPromptPatches } from '../../utils/code_prompt_evolution'
import { clearEvolvedHints } from '../../utils/code_evolved_config'
import { clearCrossAgentBridge } from '../../utils/code_cross_agent_memory'
import { clearUserPreferences } from '../../utils/code_user_preferences'
import { getCodeAgentEnv } from '../../utils/code_agent_env'
import { existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

type ResetScope = 'all' | 'learning' | 'route' | 'prompts' | 'metrics' | 'vectors' | 'cross' | 'prefs'

function clearCodeMetrics() {
  const dir = join(process.cwd(), '.data')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  try {
    writeFileSync(join(dir, 'code-query-metrics.jsonl'), '', 'utf8')
  } catch {
    /* ignore */
  }
}

export default defineEventHandler(async (event) => {
  if (!getCodeAgentEnv().enableLearningLoop) {
    return { ok: true, scope: 'none', note: 'learning disabled' }
  }
  const body = await readBody<{ scope?: ResetScope }>(event).catch(() => ({}))
  const scope: ResetScope = body?.scope ?? 'all'

  if (scope === 'all' || scope === 'learning') clearLearningData()
  if (scope === 'all' || scope === 'route') clearRoutePreferences()
  if (scope === 'all' || scope === 'prompts') {
    clearPromptPatches()
    clearEvolvedHints()
  }
  if (scope === 'all' || scope === 'metrics') clearCodeMetrics()
  if (scope === 'all' || scope === 'vectors') clearExperienceVectors()
  if (scope === 'all' || scope === 'cross') clearCrossAgentBridge()
  if (scope === 'all' || scope === 'prefs') clearUserPreferences()

  return { ok: true, scope }
})
