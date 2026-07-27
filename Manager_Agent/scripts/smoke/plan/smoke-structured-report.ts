/**
 * 结构化报告契约回归
 */
import {
  buildStructuredRunReport,
  formatStructuredRunReportMarkdown,
  appendStructuredReportIfNeeded
} from '../../../server/graph/core/output/structuredRunReport'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

assert(
  buildStructuredRunReport({ intent: 'db', plan: [{ agent: 'db' }] }) === null,
  'single hop skips structured report'
)

const report = buildStructuredRunReport({
  goal: '查库并写报告',
  intent: 'multi',
  plan: [
    { id: 's1', agent: 'db', query: '查人数' },
    { id: 's2', agent: 'report', query: '写汇总' }
  ],
  stepRecords: [
    { id: 's1', agent: 'db', status: 'ok' },
    { id: 's2', agent: 'report', status: 'error', error: 'timeout' }
  ],
  evidence: [{ kind: 'db', query: '人数' }],
  meta: {}
})
assert(report, 'multi should build report')
assert(report!.steps.length === 2, 'steps mirrored')
assert(report!.failures.some((f) => f.includes('report')), 'failure listed')
assert(report!.evidence.length >= 1, 'evidence listed')

const md = formatStructuredRunReportMarkdown(report!)
assert(md.includes('## 执行摘要'), 'markdown has summary heading')
assert(md.includes('### 已执行步骤'), 'markdown has steps')

const once = appendStructuredReportIfNeeded('正文', report)
const twice = appendStructuredReportIfNeeded(once, report)
assert(once.includes('## 执行摘要'), 'appended once')
assert(twice === once, 'no duplicate append')

console.log('smoke-structured-report: ok')
