/**
 * Manager finalize → db_query_experience 同步（DB Agent 长期记忆联邦写入）
 */

import { recordMemory } from './agentMemoryApi'
import { shouldSyncDbExperience, type RunOutcomeInput } from './agentOutcomePolicy'
import { isAgentPgConfigured } from './agentPgClient'

export function isDbExperienceBridgeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.MGR_DB_EXPERIENCE_SYNC ?? '1').trim() !== '0'
}

export function normalizeDbQuestionKey(question: string): string {
  return String(question ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[，,。.;；:：!?？]/g, '')
    .slice(0, 120)
}

function buildDbHint(input: {
  question: string
  resultText: string
  dataDomain?: string
  path?: string
}): string {
  const domain = String(input.dataDomain || 'general').slice(0, 64)
  const path = String(input.path || 'sql_direct').slice(0, 32)
  const snippet = String(input.resultText || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200)
  return `数据域=${domain}；成功路径=${path}；结果摘要=${snippet || input.question.slice(0, 80)}`
}

export async function syncDbExperienceFromManagerRun(
  input: RunOutcomeInput & {
    question: string
    dataDomain?: string
    dbPath?: string
    tables?: string[]
  },
  env: NodeJS.ProcessEnv = process.env,
  opts?: { force?: boolean }
): Promise<{ synced: boolean; reason?: string }> {
  if (!isDbExperienceBridgeEnabled(env)) return { synced: false, reason: 'disabled' }
  if (!shouldSyncDbExperience(input, env, opts)) return { synced: false, reason: 'not_eligible' }
  if (!isAgentPgConfigured(env)) return { synced: false, reason: 'pg_not_configured' }

  const dbText = String(input.results.db ?? input.results.DB ?? '')
  const question_norm = normalizeDbQuestionKey(input.question)
  if (!question_norm) return { synced: false, reason: 'empty_question' }

  const hint = buildDbHint({
    question: input.question,
    resultText: dbText,
    dataDomain: input.dataDomain,
    path: input.dbPath || 'sql_direct'
  })

  const r = await recordMemory(
    {
      type: 'experience',
      agent: 'db',
      successScore: input.successScore,
      payload: {
        ts: new Date().toISOString(),
        question_norm,
        path: input.dbPath || 'sql_direct',
        data_domain: input.dataDomain || process.env.DB_AGENT_DOMAIN || 'general',
        tables: input.tables?.length ? input.tables : undefined,
        hint,
        source: opts?.force ? 'manager_feedback_confirmed' : 'manager_finalize_sync',
        userConfirmed: Boolean(opts?.force)
      }
    },
    env
  )
  return r.ok ? { synced: true } : { synced: false, reason: r.reason || 'write_failed' }
}
