/**
 * Manager finalize → lob_gui_experience 同步（Lobster/GUI Agent 长期记忆联邦写入）
 */

import { agentPgQuery, isAgentPgConfigured } from './agentPgClient'
import { shouldSyncGuiExperience, type RunOutcomeInput } from './agentOutcomePolicy'
import { normalizeDbQuestionKey } from './dbExperienceBridge'

export function isGuiExperienceBridgeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.MGR_GUI_EXPERIENCE_SYNC ?? '1').trim() !== '0'
}

function buildGuiHint(input: {
  question: string
  resultText: string
  scenario?: string
  executionMode?: string
}): string {
  const parts = [
    input.scenario ? `场景=${input.scenario}` : '',
    input.executionMode ? `模式=${input.executionMode}` : '',
    String(input.resultText || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200)
  ].filter(Boolean)
  return parts.join('；') || input.question.slice(0, 120)
}

export async function syncGuiExperienceFromManagerRun(
  input: RunOutcomeInput & {
    question: string
    scenario?: string
    executionMode?: string
  },
  env: NodeJS.ProcessEnv = process.env,
  opts?: { force?: boolean }
): Promise<{ synced: boolean; reason?: string }> {
  if (!isGuiExperienceBridgeEnabled(env)) return { synced: false, reason: 'disabled' }
  if (!shouldSyncGuiExperience(input, env, opts)) return { synced: false, reason: 'not_eligible' }
  if (!isAgentPgConfigured(env)) return { synced: false, reason: 'pg_not_configured' }

  const question = String(input.question || '').trim()
  const task_norm = normalizeDbQuestionKey(question)
  if (!task_norm) return { synced: false, reason: 'empty_question' }

  const guiText = String(input.results.gui ?? input.results.Gui ?? '')
  const hint = buildGuiHint({
    question,
    resultText: guiText,
    scenario: input.scenario,
    executionMode: input.executionMode
  })

  const res = await agentPgQuery(
    `INSERT INTO lob_gui_experience
      (ts, task_norm, scenario, execution_mode, hint, source, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'confirmed')`,
    [
      new Date().toISOString(),
      task_norm,
      input.scenario?.slice(0, 64) ?? null,
      input.executionMode?.slice(0, 16) ?? null,
      hint,
      'manager_finalize_sync'
    ],
    env
  )
  return res ? { synced: true } : { synced: false, reason: 'write_failed' }
}
