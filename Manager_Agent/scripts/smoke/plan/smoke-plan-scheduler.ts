/**
 * 调度 DAG 回归：不拉 LangGraph / composeFinal。
 */
import { finalizePlanForExecution, applyPipelineTopologyToPlan } from '../../../server/graph/core/plan'
import {
  canForceRunPendingStep,
  enforceSemanticDependsOn,
  isStepReadyForExecution,
  stepUpstreamTerminal
} from '../../../server/graph/core/plan/planParallel'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

const plan = enforceSemanticDependsOn([
  { id: 's_rag', agent: 'rag', query: 'a' },
  { id: 's_crawl', agent: 'crawler', query: 'b' },
  { id: 's_clean', agent: 'clean', query: 'cl' },
  { id: 's_code', agent: 'code', query: 'c' },
  { id: 's_viz', agent: 'visualize', query: 'd' },
  { id: 's_report', agent: 'report', query: 'r' }
])

const codeStep = plan.find((s) => s.agent === 'code')!
const vizStep = plan.find((s) => s.agent === 'visualize')!
const reportStep = plan.find((s) => s.agent === 'report')!
const cleanStep = plan.find((s) => s.agent === 'clean')!

assert(codeStep.dependsOn?.includes('s_clean'), 'code waits clean')
assert(!codeStep.dependsOn?.includes('s_rag'), 'code must not wait raw fetch when clean present')
assert(cleanStep.dependsOn?.includes('s_rag') && cleanStep.dependsOn?.includes('s_crawl'), 'clean waits all fetch')
assert(vizStep.dependsOn?.join() === 's_code', 'visualize only waits code')
assert(reportStep.dependsOn?.join() === 's_code', 'report only waits code')

assert(!isStepReadyForExecution(vizStep, plan, { s_rag: { status: 'ok' }, s_crawl: { status: 'ok' } }), 'viz blocked before code')
assert(
  isStepReadyForExecution(vizStep, plan, { s_rag: { status: 'ok' }, s_crawl: { status: 'ok' }, s_code: { status: 'ok' } }),
  'viz ready after code'
)

const afterFetch = { s_rag: { status: 'skipped' }, s_crawl: { status: 'ok' }, s_clean: { status: 'ok' } } as Record<
  string,
  { status: string }
>
assert(isStepReadyForExecution(codeStep, plan, afterFetch), 'code ready when fetch terminal + clean ok')
assert(
  !isStepReadyForExecution(codeStep, plan, { s_rag: { status: 'ok' }, s_crawl: { status: 'ok' } }),
  'code blocked until clean finishes'
)
assert(
  canForceRunPendingStep(codeStep, plan, afterFetch),
  'code forceable when fetch terminal'
)
assert(stepUpstreamTerminal({ status: 'skipped' }), 'skipped counts as terminal upstream')

const finalized = finalizePlanForExecution([
  { id: 's_rag', agent: 'rag', query: 'a' },
  { id: 's_crawl', agent: 'crawler', query: 'b' },
  { id: 's_clean', agent: 'clean', query: 'cl' },
  { id: 's_code', agent: 'code', query: 'c' },
  { id: 's_viz', agent: 'visualize', query: 'd' },
  { id: 's_report', agent: 'report', query: 'r' }
])
const finCode = finalized.find((s) => s.agent === 'code')!
const finClean = finalized.find((s) => s.agent === 'clean')!
assert(finCode.dependsOn?.includes('s_clean'), 'finalize: code waits clean')
assert(finClean.dependsOn?.includes('s_rag') && finClean.dependsOn?.includes('s_crawl'), 'finalize: clean waits fetch')
const finViz = finalized.find((s) => s.agent === 'visualize')!
const finReport = finalized.find((s) => s.agent === 'report')!
assert(finViz.parallelGroup === 'output' && finReport.parallelGroup === 'output', 'finalize: output parallelGroup')
const afterFetchFin = {
  s_rag: { status: 'skipped' },
  s_crawl: { status: 'ok' },
  s_clean: { status: 'ok' }
} as Record<string, { status: string }>
assert(
  isStepReadyForExecution(finCode, finalized, afterFetchFin),
  'finalize: code runnable after fetch + clean'
)

const mmPlan = enforceSemanticDependsOn([
  { id: 's_mm', agent: 'multimodal', query: '识图' },
  { id: 's_music', agent: 'music', query: '配乐' }
])
assert(mmPlan.find((s) => s.agent === 'music')?.dependsOn?.includes('s_mm'), 'music waits multimodal')

console.log('smoke: plan scheduler ok')

const misplaced = finalizePlanForExecution([
  { id: 's_db', agent: 'db', query: '查中医记录' },
  { id: 's_report', agent: 'report', query: '生成分析报告' },
  { id: 's_clean', agent: 'clean', query: '清洗对齐字段' }
])
assert(
  misplaced.map((s) => s.agent).join('→') === 'db→clean→report',
  `misplaced clean reordered: ${misplaced.map((s) => s.agent).join('→')}`
)
assert(misplaced.find((s) => s.agent === 'report')?.dependsOn?.includes('s_clean'), 'report waits clean')

const dbReportTopo = applyPipelineTopologyToPlan(
  [
    { id: 's_db', agent: 'db', query: '查记录' },
    { id: 's_report', agent: 'report', query: '写报告' }
  ],
  '查记录并写报告'
)
assert(dbReportTopo.some((s) => s.agent === 'clean'), 'db+report inserts clean layer')
assert(dbReportTopo.some((s) => s.agent === 'code'), 'db+report inserts code layer')
const topoAgents = dbReportTopo.map((s) => s.agent).join('→')
assert(topoAgents.indexOf('clean') < topoAgents.indexOf('report'), `clean before report: ${topoAgents}`)

console.log('smoke: clean pipeline order ok')
