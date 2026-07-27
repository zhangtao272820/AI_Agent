/**
 * Manager finalize → adm_tool_experience 同步（Admin Agent 长期记忆联邦写入）
 */

import { agentPgQuery, isAgentPgConfigured } from './agentPgClient'
import { shouldSyncAdminExperience, type RunOutcomeInput } from './agentOutcomePolicy'
import { normalizeDbQuestionKey } from './dbExperienceBridge'

export function isAdminExperienceBridgeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.MGR_ADMIN_EXPERIENCE_SYNC ?? '1').trim() !== '0'
}

const SCENARIO_TOOL: Record<string, string> = {
  daily_briefing: 'daily_briefing',
  email_triage: 'triage_emails',
  meeting_prep: 'prepare_meeting',
  ask_database: 'ask_database',
  weekly_report: 'weekly_report',
  meeting_minutes: 'extract_meeting_actions',
  lobster_automation: 'lobster_browser_task',
  travel_route: 'amap_route',
  feishu_calendar: 'sync_feishu_calendar',
  feishu_notify: 'send_feishu_message',
  reminder_notify: 'schedule_reminder'
}

function inferScenario(input: { scenarioKey?: string; intent?: string }): string | undefined {
  const key = String(input.scenarioKey || input.intent || '')
    .trim()
    .slice(0, 64)
  return key || undefined
}

function buildAdminHint(input: {
  question: string
  resultText: string
  scenario?: string
  toolName?: string
}): string {
  const scenario = String(input.scenario || 'general').slice(0, 64)
  const tool = String(input.toolName || 'admin').slice(0, 64)
  const snippet = String(input.resultText || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200)
  return `场景=${scenario}；工具=${tool}；结果摘要=${snippet || input.question.slice(0, 80)}`
}

export async function syncAdminExperienceFromManagerRun(
  input: RunOutcomeInput & {
    question: string
    scenarioKey?: string
    intent?: string
  },
  env: NodeJS.ProcessEnv = process.env,
  opts?: { force?: boolean }
): Promise<{ synced: boolean; reason?: string }> {
  if (!isAdminExperienceBridgeEnabled(env)) return { synced: false, reason: 'disabled' }
  if (!shouldSyncAdminExperience(input, env, opts)) return { synced: false, reason: 'not_eligible' }
  if (!isAgentPgConfigured(env)) return { synced: false, reason: 'pg_not_configured' }

  const question = String(input.question || '').trim()
  const question_norm = normalizeDbQuestionKey(question)
  if (!question_norm) return { synced: false, reason: 'empty_question' }

  const adminText = String(input.results.admin ?? input.results.Admin ?? '')
  const scenario = inferScenario({ scenarioKey: input.scenarioKey, intent: input.intent })
  const toolName = (scenario && SCENARIO_TOOL[scenario]) || 'admin_task'
  const hint = buildAdminHint({ question, resultText: adminText, scenario, toolName })

  const res = await agentPgQuery(
    `INSERT INTO adm_tool_experience (ts, question_norm, tool_name, scenario, hint, source, status, run_id, tools_json)
     VALUES ($1, $2, $3, $4, $5, $6, 'confirmed', NULL, '[]'::jsonb)`,
    [
      new Date().toISOString(),
      question_norm,
      toolName,
      scenario ?? null,
      hint,
      'manager_finalize_sync'
    ],
    env
  )
  return res ? { synced: true } : { synced: false, reason: 'write_failed' }
}
