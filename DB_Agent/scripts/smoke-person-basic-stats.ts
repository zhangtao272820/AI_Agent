/**
 * person_info 快路径 smoke：mock Plan，不绑 MySQL / 不绑线网。
 */
import { assemblePlanSlotsOrNull } from '../utils/nlu/assemble_plan_slots.ts'
import {
  applyExecutionShapeToPlan,
  guardExecutionShapeForPersonDistribution,
  guardExecutionShapeForRegionPopulation,
  isFilteredPersonDistributionPlan,
  isRegionPopulationCountPlan,
} from '../utils/nlu/dbQueryExecutionShapeLlm.ts'
import {
  parsePersonStatFilters,
  personInfoStatsEligible,
  runPersonInfoStatsFastPath,
  tryPersonInfoFilteredStats,
} from '../utils/person/infoStats.ts'
import type { QueryPlan } from '../utils/nlu/query_plan.ts'
import { defaultQueryPlan } from '../utils/nlu/query_plan.ts'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

function basePlan(partial: Partial<QueryPlan>): QueryPlan {
  return { ...defaultQueryPlan(), confidence: 0.85, ...partial }
}

async function main() {
  const dirty = basePlan({
    intent: 'aggregation',
    subject: 'person',
    data_domain: 'person_basic',
    entities: { names: [], locations: ['数据库查河西区'], orgs: [], ids: [] },
    metrics: ['人数'],
  })
  const assembledDirty = assemblePlanSlotsOrNull(dirty)
  assert(assembledDirty === null, 'dirty location must reject assemble')

  const clean = basePlan({
    intent: 'aggregation',
    subject: 'person',
    data_domain: 'person_basic',
    entities: { names: [], locations: ['河西区'], orgs: [], ids: [] },
    metrics: ['老人人数'],
    filters: {
      time_range: { start: '', end: '', relative: '' },
      where: [],
      slots: [{ field_hint: 'region', value: '河西区', sql_match_value: '河西区' }],
    },
  })
  const assembledClean = assemblePlanSlotsOrNull(clean)
  assert(assembledClean?.entities.locations[0] === '河西区', 'clean region passes assemble')

  const filters = parsePersonStatFilters(assembledClean)
  assert(filters?.regionLike === '河西区', `region from plan slots: ${filters?.regionLike}`)

  // 老人语义不再由 assemble 硬补 age_gte=60（交完备门 / Slot LLM）
  const elderPlan = assemblePlanSlotsOrNull(
    basePlan({
      intent: 'aggregation',
      subject: 'person',
      data_domain: 'person_basic',
      entities: { names: [], locations: ['河西区'], orgs: [], ids: [] },
      metrics: ['老人人数'],
      filters: {
        time_range: { start: '', end: '', relative: '' },
        where: [],
        slots: [{ field_hint: 'region', value: '河西区', sql_match_value: '河西区' }],
      },
    }),
  )
  assert(
    !elderPlan?.filters.slots.some((s) => s.field_hint === 'age_gte' && s.sql_match_value === '60'),
    'assemble must NOT hardcode age_gte=60 for elder metrics',
  )

  const noSlot = basePlan({
    intent: 'aggregation',
    subject: 'person',
    metrics: ['人数'],
  })
  assert(parsePersonStatFilters(noSlot) === null, 'missing slots must not regex-fallback')
  assert(!personInfoStatsEligible(noSlot), 'eligible requires plan slots')

  const agePlan = assemblePlanSlotsOrNull(
    basePlan({
      intent: 'aggregation',
      subject: 'person',
      data_domain: 'person_basic',
      entities: { names: [], locations: ['河西区'], orgs: [], ids: [] },
      dimensions: ['性别'],
      filters: {
        time_range: { start: '', end: '', relative: '' },
        where: [],
        slots: [{ field_hint: 'age', value: '70-79', sql_match_value: '70-79' }],
      },
    }),
  )
  assert(agePlan?.filters.slots.some((s) => s.field_hint === 'age_gte'), 'age range expands to age_gte slot')

  const nullStats = await tryPersonInfoFilteredStats({ query: async () => [] } as any, noSlot)
  assert(nullStats === null, 'no slots returns null not regex guess')

  const paraphrasePlan = basePlan({
    intent: 'detail',
    subject: 'person',
    data_domain: 'person_basic',
    entities: { names: [], locations: ['河西区'], orgs: [], ids: [] },
    metrics: ['老年人口数量'],
    filters: {
      time_range: { start: '', end: '', relative: '' },
      where: [],
      slots: [{ field_hint: 'region', value: '河西区', sql_match_value: '河西区' }],
    },
  })
  assert(isRegionPopulationCountPlan(paraphrasePlan), 'paraphrase B plan is region population count')
  assert(
    guardExecutionShapeForRegionPopulation(paraphrasePlan, 'detail_rows') === 'scalar_lookup',
    'detail_rows LLM must be guarded to scalar_lookup for region count',
  )
  const paraphraseFilters = parsePersonStatFilters(paraphrasePlan)
  assert(paraphraseFilters?.regionLike === '河西区', 'region filters survive intent=detail coercion')
  const countSql = await runPersonInfoStatsFastPath(
    { query: async (sql: string) => [{ count: sql.includes('COUNT(*)') ? 9 : 0 }] } as any,
    paraphrasePlan,
  )
  assert(countSql?.includes('9'), `detail intent still counts: ${countSql}`)

  // 性别分布：即使 LLM 误判 detail_rows，也不得清空维度/不得走明细列表
  const genderDistPlan = basePlan({
    intent: 'aggregation',
    subject: 'person',
    data_domain: 'person_basic',
    entities: { names: [], locations: ['河西区'], orgs: [], ids: [] },
    metrics: ['性别分布'],
    dimensions: ['性别'],
    filters: {
      time_range: { start: '', end: '', relative: '' },
      where: [],
      slots: [
        { field_hint: 'region', value: '河西区', sql_match_value: '河西区' },
        { field_hint: 'age', value: '70-79', sql_match_value: '70-79' },
      ],
    },
  })
  const genderAssembled = assemblePlanSlotsOrNull(genderDistPlan)
  assert(genderAssembled != null, 'gender dist plan assembles')
  assert(isFilteredPersonDistributionPlan(genderAssembled), 'filtered person distribution plan')
  assert(
    guardExecutionShapeForPersonDistribution(genderAssembled, 'detail_rows') === 'distribution',
    'detail_rows must coerce to distribution for gender+filters',
  )
  const afterWrongDetail = applyExecutionShapeToPlan(genderAssembled!, 'detail_rows')
  assert(
    (afterWrongDetail.dimensions ?? []).some((d) => String(d).includes('性别')),
    'detail_rows must not wipe gender dimensions on filtered dist plan',
  )

  const genderRows = await tryPersonInfoFilteredStats(
    {
      query: async () => [
        { gender: '女', count: 5 },
        { gender: '男', count: 2 },
      ],
    } as any,
    afterWrongDetail,
    'distribution',
  )
  assert(genderRows?.includes('女') && genderRows?.includes('5'), `gender GROUP BY answer: ${genderRows}`)
  assert(!/找到\s*\d+\s*条相关记录/.test(genderRows ?? ''), 'must not wrap as detail listing')

  // 计划暗示年龄（where 含年龄段）但 slots 未结构化展开失败时 → 拒绝假分布
  const ageImpliedMissing = basePlan({
    intent: 'aggregation',
    subject: 'person',
    data_domain: 'person_basic',
    entities: { names: [], locations: ['河西区'], orgs: [], ids: [] },
    metrics: ['性别分布'],
    dimensions: ['性别'],
    filters: {
      time_range: { start: '', end: '', relative: '' },
      where: ['年龄段 70-79'],
      slots: [{ field_hint: 'region', value: '河西区', sql_match_value: '河西区' }],
    },
  })
  // 故意不经 assemble（where 含区间但未 expand）以验证 fast-path 拒绝逻辑；若 assemble 会抽 age
  const refuse = await tryPersonInfoFilteredStats(
    { query: async () => [{ gender: '男', count: 8 }] } as any,
    {
      ...ageImpliedMissing,
      filters: {
        ...ageImpliedMissing.filters,
        slots: [{ field_hint: 'region', value: '河西区', sql_match_value: '河西区' }],
      },
    },
    'distribution',
  )
  // where 含 70-79 → ageFromPlan 能从 where 抽到；若抽到则应带 age 过滤而非 null。验证 assemble 路径完整。
  const assembledImplied = assemblePlanSlotsOrNull(ageImpliedMissing)
  assert(assembledImplied?.filters.slots.some((s) => String(s.field_hint).includes('age')), 'where age range expands in assemble')
  const withAge = parsePersonStatFilters(assembledImplied)
  assert(withAge?.ageGte === 70 && withAge?.ageLte === 79, `assembled age range: ${JSON.stringify(withAge)}`)

  // 完备门标缺 age 且 filters 无 age → 拒绝快路径
  const vagueAge = basePlan({
    intent: 'aggregation',
    subject: 'person',
    data_domain: 'person_basic',
    entities: { names: [], locations: ['河西区'], orgs: [], ids: [] },
    metrics: ['性别分布'],
    dimensions: ['性别'],
    filters: {
      time_range: { start: '', end: '', relative: '' },
      where: [],
      slots: [{ field_hint: 'region', value: '河西区', sql_match_value: '河西区' }],
    },
  })
  const refused = await tryPersonInfoFilteredStats(
    { query: async () => [{ gender: '男', count: 8 }] } as any,
    vagueAge,
    'distribution',
    {
      ready_to_skip_slot_llm: false,
      needs_schema_refine: true,
      missing_slots: ['age_gte'],
      implied_filters: [],
      allow_person_fast_path: true,
      confidence: 0.8,
      reason: 'test_missing_age',
      source: 'llm',
    },
  )
  assert(refused === null, 'completeness missing age_gte must refuse incomplete gender path')

  const deniedFast = await tryPersonInfoFilteredStats(
    { query: async () => [{ gender: '男', count: 5 }] } as any,
    genderAssembled,
    'distribution',
    {
      ready_to_skip_slot_llm: true,
      needs_schema_refine: false,
      missing_slots: [],
      implied_filters: [],
      allow_person_fast_path: false,
      confidence: 0.9,
      reason: 'test_deny_fast',
      source: 'llm',
    },
  )
  assert(deniedFast === null, 'allow_person_fast_path=false must refuse')
  void refuse

  const routeNode = await import('node:fs').then((fs) =>
    fs.readFileSync(new URL('../utils/route/pickPath.ts', import.meta.url), 'utf8'),
  )
  assert(routeNode.includes('personInfoStatsEligible(plan)'), 'route uses plan-only eligibility')

  console.log('smoke-person-basic-stats: OK')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
