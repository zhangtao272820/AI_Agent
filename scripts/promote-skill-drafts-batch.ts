/**
 * 高置信 Skill draft 批量 promote CLI
 * npx tsx scripts/promote-skill-drafts-batch.ts [--dry-run] [--min-score=0.85] [--skip-verify]
 */

import { verifyBeforePromote } from '../shared/evolutionVerify'
import {
  listSkillDraftsFromPg,
  promoteSkillDraft
} from '../Manager_Agent/server/utils/skillDraftFromSuccess'

const dryRun = process.argv.includes('--dry-run')
const skipVerify = process.argv.includes('--skip-verify') || dryRun
const minScoreArg = process.argv.find((a) => a.startsWith('--min-score='))
const minScore = minScoreArg ? Number(minScoreArg.split('=')[1]) : Number(process.env.MGR_SKILL_BATCH_PROMOTE_MIN_SCORE ?? 0.85)

async function main() {
  if (!skipVerify) {
    const v = await verifyBeforePromote('manager')
    if (!v.ok) {
      console.error('verify failed:', v.reason)
      process.exit(1)
    }
  }

  const rows = await listSkillDraftsFromPg({
    status: 'draft',
    minScore: Number.isFinite(minScore) ? minScore : 0.85,
    limit: 50
  })

  const seen = new Set<string>()
  const unique = rows.filter((r) => {
    if (seen.has(r.skillId)) return false
    seen.add(r.skillId)
    return true
  })

  if (dryRun) {
    console.log(
      'promote-skill-drafts-batch:',
      JSON.stringify(
        { eligible: unique.length, promotedIds: unique.map((r) => r.skillId), minScore },
        null,
        2
      )
    )
    console.log('(dry-run: no writes)')
    return
  }

  const promotedIds: string[] = []
  const failed: Array<{ skillId: string; reason: string }> = []
  for (const row of unique) {
    try {
      await promoteSkillDraft(row.skillId, { markdown: row.markdown, syncPg: true })
      promotedIds.push(row.skillId)
    } catch (e) {
      failed.push({ skillId: row.skillId, reason: String((e as Error)?.message || e) })
    }
  }

  console.log(
    'promote-skill-drafts-batch:',
    JSON.stringify({ eligible: unique.length, promoted: promotedIds.length, promotedIds, failed, minScore }, null, 2)
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
