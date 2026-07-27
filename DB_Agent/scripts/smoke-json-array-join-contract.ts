/**
 * 契约：JSON 数组关联不得被 detail 列数否决；错位 metrics 不得盖住列注释标签。
 * 用法: npx tsx scripts/smoke-json-array-join-contract.ts
 */
import { defaultQueryPlan } from '../utils/nlu/query_plan.ts'
import {
  mergeResultModeIntoSpec,
  shouldRejectIncompleteDetailLink,
  detailEnumerateRowsLookIncomplete,
} from '../utils/nlu/dbSchemaLinkResultMode.ts'
import {
  formatSingleScalarValue,
  formatValueWithPlan,
  metricOverlapsFilterHint,
} from '../utils/nlu/dbAnswerFormat.ts'
import type { SchemaLinkSpec } from '../utils/nlu/dbSchemaLinkLlm.ts'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

const root = dirname(fileURLToPath(import.meta.url))

const jsonSpec = {
  mode: 'json_array_join' as const,
  result_cardinality: 'distinct_set' as const,
  use_distinct: true,
}

assert(shouldRejectIncompleteDetailLink('detail_rows', jsonSpec) === false, 'json join must not reject')
assert(
  shouldRejectIncompleteDetailLink('detail_rows', { mode: 'single_table', result_cardinality: 'enumerate_rows' }) ===
    true,
  'plain enumerate still rejects',
)

const oneColRows = [{ problem_name: '测试题库1' }]
assert(detailEnumerateRowsLookIncomplete(oneColRows) === true, 'one col looks incomplete structurally')
assert(
  !(
    shouldRejectIncompleteDetailLink('detail_rows', jsonSpec) &&
    detailEnumerateRowsLookIncomplete(oneColRows)
  ),
  'combined gate must allow json join one-col',
)

const baseSpec: SchemaLinkSpec = {
  mode: 'json_array_join',
  anchor_table: 'teaching_course_info',
  filters: [],
  select: [{ table: 'teaching_problem_info', column: 'problem_name' }],
  json_array_join: {
    from_table: 'teaching_course_info',
    json_column: 'arr_problem_id',
    to_table: 'teaching_problem_info',
    to_column: 'id',
    select: [{ table: 'teaching_problem_info', column: 'problem_name' }],
  },
  result_cardinality: 'distinct_set',
  use_distinct: true,
  limit: 10,
  confidence: 0.7,
  reason: 'test',
}

const mergedScalar = mergeResultModeIntoSpec(baseSpec, {
  executionShape: 'scalar_lookup',
  resultCardinality: baseSpec.result_cardinality,
})
assert(mergedScalar.result_cardinality === 'distinct_set', 'scalar_lookup must not overwrite distinct_set')
assert(mergedScalar.use_distinct === true, 'keep use_distinct')

const mergedDetail = mergeResultModeIntoSpec(baseSpec, {
  executionShape: 'detail_rows',
  resultCardinality: baseSpec.result_cardinality,
})
assert(mergedDetail.result_cardinality === 'distinct_set', 'detail_rows must not overwrite distinct_set')
assert(mergedDetail.use_distinct === true, 'detail keep use_distinct')

const badPlan = {
  ...defaultQueryPlan(),
  metrics: ['课程名称'],
  filters: {
    time_range: { start: '', end: '', relative: '' },
    where: ['课程名称=测试课程'],
    slots: [{ field_hint: '课程名称', value: '测试课程', sql_match_value: '测试课程' }],
  },
}
assert(metricOverlapsFilterHint(badPlan) === true, 'metric overlaps filter hint')
const labeled = formatSingleScalarValue(badPlan, '测试题库1、测试题库2')
assert(!labeled.startsWith('课程名称'), `must not use course name label: ${labeled}`)
assert(labeled.includes('测试题库'), 'keeps values')

const withCol = formatSingleScalarValue(badPlan, '测试题库1', { columnLabel: '题库名称' })
assert(withCol.startsWith('题库名称'), `prefer column label: ${withCol}`)

const humanized = formatValueWithPlan('测试题库1、测试题库2', badPlan, 'scalar_lookup')
assert(!humanized.startsWith('课程名称'), `humanize no course label: ${humanized}`)

const { inferQueryTierStructural, planLooksLikeLinkedAttribute } = await import(
  '../utils/nlu/dbComplexityLlm.ts'
)
const linkedPlan = {
  ...defaultQueryPlan(),
  intent: 'aggregation' as const,
  metrics: ['题库名称'],
  filters: {
    time_range: { start: '', end: '', relative: '' },
    where: ['课程名称=测试课程'],
    slots: [{ field_hint: '课程名称', value: '测试课程', sql_match_value: '测试课程' }],
  },
}
assert(planLooksLikeLinkedAttribute(linkedPlan) === true, 'linked attribute detected')
const tier = inferQueryTierStructural('课程绑定题库', linkedPlan)
assert(tier?.tier === 'L3' || tier?.tier === 'L5', `linked attr tier not L2, got ${tier?.tier}`)
assert(tier?.tier !== 'L2', 'must not be L2 单表多条件')

const scalarLookupSrc = readFileSync(join(root, '../utils/sql/direct/scalarLookup.ts'), 'utf8')
assert(scalarLookupSrc.includes('shouldRejectIncompleteDetailLink'), 'scalarLookup uses reject helper')
assert(scalarLookupSrc.includes('json_array_join'), 'scalarLookup maps join to scalar answer')
assert(scalarLookupSrc.includes('stashQueryTier'), 'scalarLookup stashes L3 on json join')

const decomposeSrc = readFileSync(join(root, '../utils/nlu/dbQueryDecompose.ts'), 'utf8')
assert(decomposeSrc.includes('attribute_lookup'), 'decompose guards attribute from distribution retry')
assert(!decomposeSrc.includes('误判非 distribution，而完备门认为缺槽：再以 distribution'), 'old distribution retry comment gone')

const structuralSrc = readFileSync(join(root, '../utils/nlu/dbSchemaLinkStructural.ts'), 'utf8')
assert(structuralSrc.includes('result_cardinality: "distinct_set"'), 'buildJsonArrayJoin defaults distinct_set')

console.log('smoke-json-array-join-contract: OK')
