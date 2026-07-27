/**
 * 批次 C 回归：HTML 解析、Markdown 表格出图、Skill ops、E2E 用例集。
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseMarkdownTableAsTabularRows, buildChartPlanFromTabularRows } from '#agent-shared/tabularChartSchema'
import { tryDeterministicVisualizeFromDbTabular } from '#agent-shared/dbPipelineDeterministic'
import { extractStructuredPayload } from '../../../server/graph/core/shared'
import {
  listSkillDrafts,
  promoteSkillDraft,
  writeSkillDraft
} from '../../../server/utils/skills/skillDraftFromSuccess'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '../../..')

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

// P3-3 partial: Markdown 表格 → 确定性出图
const mdTable = `
| 地区 | 销售额 |
| --- | --- |
| 华东 | 120 |
| 华南 | 80 |
| 华北 | 60 |
`
const mdRows = parseMarkdownTableAsTabularRows(mdTable)
assert(mdRows?.length === 3, 'markdown table rows')
const mdPlan = buildChartPlanFromTabularRows(mdRows!, '区域销售')
assert(Boolean(mdPlan?.panels.length), 'markdown chart plan')

const dbMdViz = tryDeterministicVisualizeFromDbTabular(
  {
    db: `查询结果如下：\n${mdTable}`
  },
  extractStructuredPayload
)
assert(Boolean(dbMdViz && dbMdViz.includes('ECHARTS_OPTION')), 'db markdown table deterministic visualize')

// Skill ops roundtrip (temp dir)
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'batch-c-skill-'))
await writeSkillDraft({ agent: 'db', question: 'batch-c smoke', hints: ['md table chart'] }, { draftsDir: tmp })
const listed = await listSkillDrafts({ draftsDir: tmp })
assert(listed.length === 1, 'skill draft list')
const skillsOut = path.join(tmp, 'skills')
const promoted = await promoteSkillDraft(listed[0]!.skillId, { draftsDir: tmp, skillsDir: skillsOut })
assert(promoted.playbookPath.includes('skills'), 'skill promote')
await fs.rm(tmp, { recursive: true, force: true })

// E2E case file sanity
const e2eRaw = await fs.readFile(path.join(root, 'eval', 'golden-e2e-paths.json'), 'utf8')
const e2e = JSON.parse(e2eRaw) as { cases?: unknown[] }
assert(Array.isArray(e2e.cases) && e2e.cases.length >= 8, 'golden e2e cases present')

console.log('smoke: batch-c ok')
