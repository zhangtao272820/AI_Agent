/**
 * 历史 Skill draft 回填 CLI
 * npx tsx scripts/backfill-skill-drafts-from-pg.ts [--dry-run]
 */

import { agentPgQuery, isAgentPgConfigured } from '../shared/agentPgClient'
import { isSkillDraftEligible } from '../shared/agentOutcomePolicy'
import { buildSkillDraftMarkdown, writeSkillDraft, type SkillSuccessSignal } from '../Manager_Agent/server/utils/skillDraftFromSuccess'

type ExperiencePayload = Record<string, unknown>

function parsePlanAgents(payload: ExperiencePayload): string[] {
  const path = payload.path
  if (Array.isArray(path)) {
    return path.map((x) => String(x ?? '').trim()).filter(Boolean)
  }
  return []
}

async function upsertSkillDraftPg(
  signal: SkillSuccessSignal & { successScore?: number },
  markdown: string,
  skillId: string
): Promise<void> {
  if (!isAgentPgConfigured()) return
  await agentPgQuery(
    `INSERT INTO mgr_skill_drafts (skill_id, agent, markdown, source_run_id, success_score, status, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'draft', NOW())
     ON CONFLICT (skill_id) DO UPDATE SET
       markdown = EXCLUDED.markdown,
       success_score = EXCLUDED.success_score,
       status = CASE WHEN mgr_skill_drafts.status = 'promoted' THEN mgr_skill_drafts.status ELSE 'draft' END,
       updated_at = NOW()`,
    [
      skillId,
      String(signal.agent || 'manager').slice(0, 32),
      markdown.slice(0, 120_000),
      null,
      typeof signal.successScore === 'number' ? signal.successScore : null
    ]
  )
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  if (!isAgentPgConfigured()) {
    console.error('AGENT_DATABASE_URL not set')
    process.exit(1)
  }

  const res = await agentPgQuery<{ payload: ExperiencePayload }>(
    `SELECT payload FROM mgr_memory_entries WHERE entry_type = 'experience' ORDER BY ts ASC LIMIT 400`
  )
  const rows = res?.rows ?? []
  let drafted = 0
  let skipped = 0
  const skillIds: string[] = []

  for (const row of rows) {
    const payload = row.payload ?? {}
    const question = String(payload.user || payload.question || '').trim()
    if (!question) {
      skipped += 1
      continue
    }
    const planAgents = parsePlanAgents(payload)
    const outcome = {
      successScore: Number(payload.successScore ?? payload.success_score ?? 0),
      needsClarify: Boolean(payload.needsClarify),
      failureCategory: String(payload.failureCategory || payload.failure_category || ''),
      planAgents,
      results: (payload.results as Record<string, unknown>) || {},
      probeDbMatched: Boolean(payload.probeDbMatched ?? payload.probe_db_matched),
      probeRagHits: Number(payload.probeRagHits ?? payload.probe_rag_hits ?? 0) || 0
    }
    if (!isSkillDraftEligible(outcome)) {
      skipped += 1
      continue
    }
    if (dryRun) {
      drafted += 1
      continue
    }
    const signal: SkillSuccessSignal & { successScore?: number } = {
      agent: 'manager',
      question,
      answer: String(payload.final || payload.answer || '').trim(),
      path: planAgents.join('→'),
      successScore: outcome.successScore,
      hints: ['source=skill_draft_backfill'],
      ok: true
    }
    const { skillId, markdown } = buildSkillDraftMarkdown(signal)
    await writeSkillDraft(signal)
    await upsertSkillDraftPg(signal, markdown, skillId)
    drafted += 1
    skillIds.push(skillId)
  }

  console.log(
    'backfill-skill-drafts-from-pg:',
    JSON.stringify({ scanned: rows.length, drafted, skipped, skillIds: skillIds.slice(0, 20) }, null, 2)
  )
  if (dryRun) console.log('(dry-run: no writes)')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
