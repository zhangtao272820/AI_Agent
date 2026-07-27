/** Phase 11：Skill draft 回填开关（实现见 Manager_Agent/server/utils/skillDraftBackfillJob.ts） */

export function isSkillDraftBackfillEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.MGR_SKILL_DRAFT_BACKFILL ?? '1').trim() !== '0'
}
