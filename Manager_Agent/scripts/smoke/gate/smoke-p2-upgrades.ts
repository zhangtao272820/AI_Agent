/**
 * P2 升级回归：孤儿数字审计、Report 门禁、downstream metrics 聚合。
 */
import { assessCodeDownstreamConsistencyStructural } from '#agent-shared/codeAuthorityPayload'
import { assessDownstreamOrphanNumbers } from '#agent-shared/codeDownstreamAudit'
import {
  assembleReportFromPlan,
  assessReportEvidenceInText,
  validateReportPlanEvidence
} from '#agent-shared/reportPlan'
import { gateReportOutput } from '#agent-shared/reportGate'
import { aggregateDownstreamMetrics } from '../../../server/graph/core/output/downstreamMetrics'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

const payload = {
  answer: '华东领先',
  facts: [
    { key: 'east', value: 100, label: '华东' },
    { key: 'west', value: 80, label: '华西' }
  ],
  data: {},
  raw: ''
}

// P2-1: 孤儿数字触发 consistency fail
const orphanReport = `<!--REPORT-->\n# 报告\n华西 80，虚构区域 9999\n<!--/REPORT-->`
const orphanGate = assessDownstreamOrphanNumbers(payload, [orphanReport])
assert(!orphanGate.pass && String(orphanGate.reason).includes('9999'), 'orphan number detected')

const consistency = assessCodeDownstreamConsistencyStructural({
  results: { code: JSON.stringify(payload), report: orphanReport },
  evidence: [{ kind: 'report', mode: 'code_authority_llm' }]
})
assert(!consistency.pass, 'critic structural gate fails on orphan')

// P2-1b: db 散文数字出现在 report，单 db+code 不得因上游合法数误伤；捏造数仍 fail
const dbProse = '查询结果：区域数 6，门店 14，库存 600，单价 10.8'
const upstreamReport = `<!--REPORT-->\n# 报告\n共 6 个区域、14 家门店，库存 600，单价 10.8\n<!--/REPORT-->`
const upstreamOk = assessCodeDownstreamConsistencyStructural({
  results: {
    db: dbProse,
    code: JSON.stringify({
      answer: '已汇总',
      facts: [{ key: 'regions', value: 6 }],
      data: {},
      raw: ''
    }),
    report: upstreamReport
  },
  evidence: [{ kind: 'report', mode: 'code_authority_llm' }]
})
assert(upstreamOk.pass, 'db+code report may cite upstream prose numbers')

const stillOrphan = assessCodeDownstreamConsistencyStructural({
  results: {
    db: dbProse,
    code: JSON.stringify({
      answer: '已汇总',
      facts: [{ key: 'regions', value: 6 }],
      data: {},
      raw: ''
    }),
    report: `<!--REPORT-->\n# 报告\n区域 6，捏造指标 9999\n<!--/REPORT-->`
  },
  evidence: [{ kind: 'report', mode: 'code_authority_llm' }]
})
assert(!stillOrphan.pass && String(stillOrphan.reason || '').includes('9999'), 'fabricated number still fails with db present')

// P2-2: report evidence 校验
const goodPlan = {
  title: '区域销售',
  executive_summary: ['华东更高'],
  key_findings: [{ claim: '华东 100', evidence_keys: ['east'], display_values: ['100'] }]
}
assert(validateReportPlanEvidence(goodPlan, payload).ok, 'report plan evidence ok')
const goodMd = assembleReportFromPlan(goodPlan)
assert(assessReportEvidenceInText(payload, goodMd).ok, 'assembled report evidence ok')

const badMd = `<!--REPORT-->\n# 报告\n- 虚构结论 [依据: missing]\n<!--/REPORT-->`
const badEvidence = assessReportEvidenceInText(payload, badMd)
assert(!badEvidence.ok, 'bad evidence rejected')

const gated = gateReportOutput(payload, orphanReport)
assert(!gated.ok && !gated.output.includes('<!--REPORT-->'), 'gate strips invalid report block')

const gatedOk = gateReportOutput(payload, goodMd)
assert(gatedOk.ok && gatedOk.output.includes('华东'), 'gate passes valid report')

// P2-4: metrics 聚合
const agg = aggregateDownstreamMetrics([
  { phase: 'downstream:clean', ok: true },
  { phase: 'downstream:clean', ok: false },
  { phase: 'downstream:chart', ok: true, firstPass: true },
  { phase: 'downstream:chart', ok: true, firstPass: false },
  { phase: 'downstream:report', ok: true, evidenceCoverage: 1 },
  { phase: 'downstream:report', ok: false, evidenceCoverage: 0 }
])
assert(agg.clean.total === 2 && agg.clean.rate === 0.5, 'clean metrics')
assert(agg.chart.firstPassRate === 0.5, 'chart first pass rate')
assert(agg.report.avgEvidenceCoverage === 0.5, 'report evidence coverage')

console.log('smoke: p2 upgrades ok')
