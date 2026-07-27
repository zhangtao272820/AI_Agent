import { readBody, getHeader } from 'h3'
import { writeSkillDraft, type SkillSuccessSignal } from '../../../utils/skills/skillDraftFromSuccess'

function verifyInternalToken(event: any): void {
  const expected = String(process.env.CLAWHIVE_INTERNAL_TOKEN || process.env.MANAGER_OPS_TOKEN || '').trim()
  if (!expected) return
  const got = String(getHeader(event, 'x-clawhive-internal-token') || '').trim()
  if (!got || got !== expected) {
    throw createError({ statusCode: 401, statusMessage: '无效的内部服务令牌' })
  }
}

export default defineEventHandler(async (event) => {
  verifyInternalToken(event)
  const body = (await readBody(event).catch(() => null)) as Partial<SkillSuccessSignal> | null
  const agent = String(body?.agent || '').trim()
  const question = String(body?.question || '').trim()
  if (!agent || !question) {
    throw createError({ statusCode: 400, statusMessage: 'agent and question required' })
  }
  const signal: SkillSuccessSignal = {
    agent,
    question,
    skillId: body?.skillId ? String(body.skillId).trim() : undefined,
    title: body?.title ? String(body.title).trim() : undefined,
    answer: body?.answer ? String(body.answer) : undefined,
    path: body?.path ? String(body.path) : undefined,
    tables: Array.isArray(body?.tables) ? body.tables.map((t) => String(t)) : undefined,
    hints: Array.isArray(body?.hints) ? body.hints.map((h) => String(h)) : undefined,
    ok: body?.ok !== false
  }
  const out = await writeSkillDraft(signal)
  return {
    ok: true,
    skillId: out.skillId,
    draftPath: out.draftPath,
    review: '人工审核后复制到 skills/<id>/skill.md 并 POST /api/internal/skills/reload'
  }
})
