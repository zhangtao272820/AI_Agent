import { readBody, getHeader } from 'h3'
import { promoteSkillDraft } from '../../../../utils/skills/skillDraftFromSuccess'

function verifyInternalToken(event: any): void {
  const expected = String(process.env.CLAWHIVE_INTERNAL_TOKEN || process.env.MANAGER_OPS_TOKEN || '').trim()
  if (!expected) return
  const got = String(getHeader(event, 'x-clawhive-internal-token') || '').trim()
  if (!got || got !== expected) {
    throw createError({ statusCode: 401, statusMessage: '无效的内部服务令牌' })
  }
}

/** POST /api/internal/skills/drafts/promote */
export default defineEventHandler(async (event) => {
  verifyInternalToken(event)
  const body = (await readBody(event).catch(() => null)) as { skillId?: string } | null
  const skillId = String(body?.skillId || '').trim()
  if (!skillId) throw createError({ statusCode: 400, statusMessage: 'skillId required' })
  const out = await promoteSkillDraft(skillId)
  return { ok: true, ...out, reload: 'POST /api/internal/skills/reload' }
})
