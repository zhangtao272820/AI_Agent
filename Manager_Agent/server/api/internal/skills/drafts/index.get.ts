import { getHeader } from 'h3'
import { listSkillDrafts } from '../../../../utils/skills/skillDraftFromSuccess'

function verifyInternalToken(event: any): void {
  const expected = String(process.env.CLAWHIVE_INTERNAL_TOKEN || process.env.MANAGER_OPS_TOKEN || '').trim()
  if (!expected) return
  const got = String(getHeader(event, 'x-clawhive-internal-token') || '').trim()
  if (!got || got !== expected) {
    throw createError({ statusCode: 401, statusMessage: '无效的内部服务令牌' })
  }
}

/** GET /api/internal/skills/drafts */
export default defineEventHandler(async (event) => {
  verifyInternalToken(event)
  const drafts = await listSkillDrafts()
  return { ok: true, drafts }
})
