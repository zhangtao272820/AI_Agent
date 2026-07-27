/**
 * 明细答装契约：审计时间噪声、扩列仅 detail（不经 answerFormat 重依赖）。
 * 用法: npx tsx scripts/smoke-detail-answer-ux.ts
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expandSpecForDetailRecord, pickDetailRecordColumns } from '../utils/nlu/dbSchemaLinkDetailRecord.ts'
import { defaultQueryPlan } from '../utils/nlu/query_plan.ts'
import type { SchemaLinkSpec } from '../utils/nlu/dbSchemaLinkLlm.ts'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

const root = dirname(fileURLToPath(import.meta.url))
const answerSrc = readFileSync(join(root, '../utils/sql/direct/answerFormat.ts'), 'utf8')
assert(/create_time/.test(answerSrc) && /isAuditNoiseKey/.test(answerSrc), 'answerFormat audits create_time')
assert(answerSrc.includes('rowsLookLikeMultiColBusinessDetail'), 'multi-col detail guard present')
assert(answerSrc.includes('gmt_modified'), 'audit set includes gmt_modified')

const resultModeSrc = readFileSync(join(root, '../utils/nlu/dbSchemaLinkResultMode.ts'), 'utf8')
assert(resultModeSrc.includes('create_time'), 'resultMode noise includes create_time')

const meta = {
  table: 'teaching_course_details',
  table_comment: '课程明细',
  columns: [
    { name: 'id', comment: '主键', data_type: 'bigint' },
    { name: 'chapter_name', comment: '章节名称', data_type: 'varchar' },
    { name: 'course_title', comment: '课程标题', data_type: 'varchar' },
    { name: 'material_title', comment: '素材标题', data_type: 'varchar' },
    { name: 'create_time', comment: '创建时间', data_type: 'datetime' },
    { name: 'update_time', comment: '更新时间', data_type: 'datetime' },
  ],
}
const plan = {
  ...defaultQueryPlan(),
  intent: 'detail' as const,
  metrics: ['课程明细'],
  filters: {
    time_range: { start: '', end: '', relative: '' },
    where: ['课程名称=测试课程'],
    slots: [{ field_hint: '课程名称', value: '测试课程', sql_match_value: '测试课程' }],
  },
}
const picked = pickDetailRecordColumns(meta as any, plan)
assert(
  !picked.some((p) => p.column === 'create_time' || p.column === 'update_time'),
  `audit times must not be picked: ${picked.map((p) => p.column).join(',')}`,
)
assert(
  picked.some((p) => p.column === 'chapter_name' || p.column === 'course_title' || p.column === 'material_title'),
  'business title/name cols expected',
)

const thinSpec: SchemaLinkSpec = {
  mode: 'single_table',
  anchor_table: 'teaching_course_details',
  filters: [{ table: 'teaching_course_details', column: 'x', op: 'eq', value: '1' }],
  select: [{ table: 'teaching_course_details', column: 'chapter_name' }],
  use_distinct: false,
  limit: 5,
  confidence: 0.7,
  reason: 'test',
}
const noExpand = expandSpecForDetailRecord(thinSpec, [meta as any], plan, 'scalar_lookup')
assert(noExpand.select.length === 1, 'scalar_lookup must not expand detail cols')
const expanded = expandSpecForDetailRecord(thinSpec, [meta as any], plan, 'detail_rows')
assert(expanded.select.length >= 2, 'detail_rows should expand')
assert(
  !expanded.select.some((s) => s.column === 'create_time'),
  'expanded select excludes create_time',
)

const intentSrc = readFileSync(join(root, '../utils/nlu/dbQueryIntentLlm.ts'), 'utf8')
assert(intentSrc.includes('课程明细分别是什么'), 'intent few-shot for course details')
assert(intentSrc.includes('绑定的题库列表是什么'), 'intent keeps bank attribute example')

const detailSrc = readFileSync(join(root, '../utils/nlu/dbSchemaLinkDetailRecord.ts'), 'utf8')
assert(detailSrc.includes('create_time'), 'SKIP_COLS has create_time')
assert(detailSrc.includes('executionShape'), 'expand gated by executionShape')

const shapeSrc = readFileSync(join(root, '../utils/nlu/dbQueryExecutionShapeLlm.ts'), 'utf8')
assert(shapeSrc.includes('planMetricsLookLikeDetailEnumerate'), 'detail enumerate helper present')
const planSrc = readFileSync(join(root, '../utils/graph/nodes/plan.ts'), 'utf8')
assert(planSrc.includes('planMetricsLookLikeDetailEnumerate'), 'plan node guards detail vs attribute')

const { planMetricsLookLikeDetailEnumerate } = await import('../utils/nlu/dbQueryExecutionShapeLlm.ts')
assert(
  planMetricsLookLikeDetailEnumerate({
    ...defaultQueryPlan(),
    metrics: ['课程明细'],
  }) === true,
  '课程明细 metrics → detail enumerate',
)
assert(
  planMetricsLookLikeDetailEnumerate({
    ...defaultQueryPlan(),
    metrics: ['题库名称'],
  }) === false,
  '题库名称 not detail enumerate',
)

console.log('smoke-detail-answer-ux: OK')
