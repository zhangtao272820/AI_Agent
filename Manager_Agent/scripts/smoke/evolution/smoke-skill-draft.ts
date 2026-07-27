import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildSkillDraftMarkdown, writeSkillDraft } from '../../../server/utils/skills/skillDraftFromSuccess'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

const { skillId, markdown } = buildSkillDraftMarkdown({
  agent: 'db',
  question: '查询销售Top5',
  path: 'plan_direct',
  tables: ['sales'],
  hints: ['先 probe 再 SQL', '空结果要说明']
})
assert(skillId.includes('db'), 'skill id prefix')
assert(markdown.includes('## When'), 'when section')
assert(markdown.includes('查询销售Top5'), 'question echoed')

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-draft-'))
const out = await writeSkillDraft(
  { agent: 'rag', question: '探视制度', answer: '探视时间为…', hints: ['retrieve-first'] },
  { draftsDir: tmp }
)
const text = await fs.readFile(out.draftPath, 'utf8')
assert(text.includes('owner: rag'), 'draft owner')
await fs.rm(tmp, { recursive: true, force: true })

console.log('smoke: skill-draft ok')
