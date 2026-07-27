/**
 * P3-C7：DB metrics.json 直出 SQL 结构回归（无 MySQL）
 */
process.env.ENABLE_METRICS_DIRECT = '1'

const { resolveMetricPatch } = await import('../utils/metrics_compiler')
const { invalidateDomainPatchCache } = await import('../utils/domain_patch')

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

process.env.DB_AGENT_DOMAIN = 'generic'
invalidateDomainPatchCache()
const genericTable = resolveMetricPatch('当前数据库有多少张表', { intent: 'aggregation' })
assert(genericTable?.id === 'schema_table_count', 'generic schema_table_count')

process.env.DB_AGENT_DOMAIN = 'p2026'
invalidateDomainPatchCache()
const personTotal = resolveMetricPatch('老人一共有多少人', { intent: 'aggregation' })
assert(personTotal?.id === 'person_total_count', 'p2026 person_total_count')

const footTrend = resolveMetricPatch('足压检测按月趋势', { intent: 'trend' })
assert(footTrend?.id === 'foot_pressure_monthly_trend', 'p2026 foot trend')

console.log('smoke: db-metrics ok')
