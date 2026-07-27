/**
 * Manager finalize → code_query_experience 同步（Code Agent 长期记忆联邦写入）
 */

import { agentPgQuery, isAgentPgConfigured } from './agentPgClient'
import { shouldSyncCodeExperience, type RunOutcomeInput } from './agentOutcomePolicy'
import { normalizeDbQuestionKey } from './dbExperienceBridge'

export function isCodeExperienceBridgeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.MGR_CODE_EXPERIENCE_SYNC ?? '1').trim() !== '0'
}

function inferTaskKind(input: { taskKind?: string; resultText: string }): string {
  const explicit = String(input.taskKind || '').trim()
  if (explicit) return explicit.slice(0, 32)
  const text = String(input.resultText || '').toLowerCase()
  if (/echarts|chart|visualiz/.test(text)) return 'visualize'
  if (/sql|query|select/.test(text)) return 'sql'
  if (/test|pytest|jest/.test(text)) return 'test'
  if (/refactor|rename/.test(text)) return 'refactor'
  return 'compute'
}

function buildCodeHint(input: {
  question: string
  resultText: string
  taskKind?: string
  hintFiles?: string[]
}): string {
  const kind = inferTaskKind(input)
  const files = (input.hintFiles || []).filter(Boolean).slice(0, 4)
  const snippet = String(input.resultText || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200)
  const filePart = files.length ? `关注文件=${files.join(',')}` : ''
  return [`路径=${kind}`, filePart, snippet ? `结果摘要=${snippet}` : ''].filter(Boolean).join('；')
}

export async function syncCodeExperienceFromManagerRun(
  input: RunOutcomeInput & {
    question: string
    taskKind?: string
    hintFiles?: string[]
  },
  env: NodeJS.ProcessEnv = process.env,
  opts?: { force?: boolean }
): Promise<{ synced: boolean; reason?: string }> {
  if (!isCodeExperienceBridgeEnabled(env)) return { synced: false, reason: 'disabled' }
  if (!shouldSyncCodeExperience(input, env, opts)) return { synced: false, reason: 'not_eligible' }
  if (!isAgentPgConfigured(env)) return { synced: false, reason: 'pg_not_configured' }

  const question = String(input.question || '').trim()
  const question_norm = normalizeDbQuestionKey(question)
  if (!question_norm) return { synced: false, reason: 'empty_question' }

  const codeText = String(input.results.code ?? input.results.Code ?? '')
  const taskKind = inferTaskKind({ taskKind: input.taskKind, resultText: codeText })
  const hint = buildCodeHint({
    question,
    resultText: codeText,
    taskKind,
    hintFiles: input.hintFiles
  })

  const res = await agentPgQuery(
    `INSERT INTO code_query_experience
      (ts, question_norm, task_kind, hint_files, hint, source, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'confirmed')`,
    [
      new Date().toISOString(),
      question_norm,
      taskKind,
      JSON.stringify((input.hintFiles || []).slice(0, 8)),
      hint,
      'manager_finalize_sync'
    ],
    env
  )
  return res ? { synced: true } : { synced: false, reason: 'write_failed' }
}
