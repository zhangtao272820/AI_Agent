/**
 * Skill 自动蒸馏：高成功率 run → verify 门禁 → draft（PG + 文件）
 */

import { verifyManagerEvolutionPromote } from '#agent-shared/evolutionVerify'
import { isSkillDraftEligible, type RunOutcomeInput } from '#agent-shared/agentOutcomePolicy'
import { agentPgQuery } from '#agent-shared/agentPgClient'
import { isAgentPgConfigured } from '#agent-shared/agentPgClient'
import { writeSkillDraft, buildSkillDraftMarkdown, type SkillSuccessSignal } from './skillDraftFromSuccess'
import { skillPathAlignsWithUser } from '../../graph/core/memory/userIntentSupremacy'

export function isSkillAutoDraftEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.MGR_SKILL_AUTO_DRAFT ?? '1').trim() !== '0'
}

function minSuccessScore(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.MGR_SKILL_AUTO_DRAFT_MIN_SCORE ?? 0.85)
  return Number.isFinite(n) && n >= 0.72 ? Math.min(0.99, n) : 0.85
}

async function upsertSkillDraftPg(
  signal: SkillSuccessSignal & { runId?: string; successScore?: number },
  markdown: string,
  skillId: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  if (!isAgentPgConfigured()) return
  await agentPgQuery(
    `INSERT INTO mgr_skill_drafts (skill_id, agent, markdown, source_run_id, success_score, status, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'draft', NOW())
     ON CONFLICT (skill_id) DO UPDATE SET
       markdown = EXCLUDED.markdown,
       source_run_id = EXCLUDED.source_run_id,
       success_score = EXCLUDED.success_score,
       status = CASE WHEN mgr_skill_drafts.status = 'promoted' THEN mgr_skill_drafts.status ELSE 'draft' END,
       updated_at = NOW()`,
    [
      skillId,
      String(signal.agent || 'manager').slice(0, 32),
      markdown.slice(0, 120_000),
      signal.runId ? String(signal.runId).slice(0, 80) : null,
      typeof signal.successScore === 'number' ? signal.successScore : null
    ],
    env
  )
}

function parsePlanAgents(path?: string): string[] {
  if (!path) return []
  return path
    .split('→')
    .flatMap((part) => part.split('->'))
    .map((s) => s.trim())
    .filter(Boolean)
}

export async function maybeAutoDraftSkillFromSuccess(
  signal: SkillSuccessSignal & {
    runId?: string
    successScore?: number
    needsClarify?: boolean
    scenarioKey?: string
    failureCategory?: string
    planAgents?: string[]
    agentResults?: Record<string, unknown>
    probeDbMatched?: boolean
    probeRagHits?: number
  },
  env: NodeJS.ProcessEnv = process.env,
  opts?: { skipVerify?: boolean }
): Promise<{ drafted: boolean; skillId?: string; reason?: string }> {
  if (!isSkillAutoDraftEnabled(env)) return { drafted: false, reason: 'disabled' }
  const score = Number(signal.successScore ?? 0)
  if (!String(signal.question || '').trim()) return { drafted: false, reason: 'empty_question' }

  const outcome: RunOutcomeInput = {
    successScore: score,
    needsClarify: signal.needsClarify,
    failureCategory: signal.failureCategory,
    planAgents: signal.planAgents?.length ? signal.planAgents : parsePlanAgents(signal.path),
    results: signal.agentResults || {},
    probeDbMatched: signal.probeDbMatched,
    probeRagHits: signal.probeRagHits
  }
  if (!isSkillDraftEligible(outcome, minSuccessScore(env))) {
    return { drafted: false, reason: signal.needsClarify ? 'needs_clarify' : 'not_eligible' }
  }

  const planAgents = outcome.planAgents || []
  if (planAgents.length && !skillPathAlignsWithUser(String(signal.question || ''), planAgents)) {
    return { drafted: false, reason: 'capability_drift' }
  }

  const verify = opts?.skipVerify
    ? { ok: true, reason: 'skip_verify' }
    : await verifyManagerEvolutionPromote().catch(() => ({ ok: false, reason: 'verify_error' }))
  if (!verify.ok) return { drafted: false, reason: verify.reason || 'verify_failed' }

  const hints = [
    ...(signal.hints || []),
    signal.path ? `成功路径：${signal.path}` : '',
    signal.scenarioKey ? `场景：${signal.scenarioKey}` : '',
    `successScore=${score.toFixed(2)}`
  ].filter(Boolean)

  const payload: SkillSuccessSignal = {
    ...signal,
    agent: signal.agent || 'manager',
    hints,
    ok: true
  }

  const { skillId, markdown } = buildSkillDraftMarkdown(payload)
  const { draftPath } = await writeSkillDraft(payload)
  await upsertSkillDraftPg({ ...payload, runId: signal.runId, successScore: score }, markdown, skillId, env)

  return { drafted: true, skillId, reason: draftPath }
}
