/**
 * P0 升级回归：不调用 LLM / 外部 Agent，仅校验关键纯函数与默认配置。
 */
import { composeFinalFromGraphResult, buildHumanConfirmCheckpoint } from '../../../server/graph/core/output/composeFinal'
import { buildAgentError } from '../../../server/graph/core/agent/agentErrors'
import { dbProbeTimeoutMs, ragProbeTimeoutMs } from '../../../server/graph/core/probe/probeConfig'
import { buildDbChartShortcutPlan, isDbChartShortcutEnabled, shouldUseDbChartShortcut, shouldUseDbOnlyShortcut, buildDbOnlyShortcutPlan } from '../../../server/graph/core/plan/planShortcuts'
import { mockIntentClassifyForTest } from '../../../server/graph/llm/intentClassifyLlm'
import { applyRoutePlanCoverage, ensurePipelineDependsOn, finalizePlanForExecution } from '../../../server/graph/core/plan'
import { isStepReadyForExecution } from '../../../server/graph/core/plan/planParallel'
import { supplementAllowedFromTaskConstraints } from '../../../server/graph/core/routing/routeFinalize'
import { resolvePrefetchTargets } from '../../../server/graph/core/probe/prefetchGate'
import { canManagerRetryMore, resolveManagerRetryLimits } from '../../../server/graph/core/runtime/retryBudget'
import {
  assembleCleanPayload,
  assembleCleanPayloadStructural,
  parseCleanPayload,
  serializeCleanPayload,
  parseSourceSnapshots,
  assessDataSufficiencyStructural,
  activeDataSources
} from '#agent-shared/cleanPayload'
import { buildStructuredFactsFromResults, buildUpstreamContextFromResults } from '../../../server/utils/code/managerCodeTaskPayload'
import { extractStructuredPayload } from '../../../server/graph/core/shared'
import { isVisualizeOutputRenderable } from '#agent-shared/chartOption'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

// P0-4: multi 重试预算
const multi = resolveManagerRetryLimits(
  { retryCount: 0, intent: 'multi', plan: [{ agent: 'db' }, { agent: 'visualize' }] },
  { critic: { maxRetriesSingle: 1, maxRetriesMulti: 2 } }
)
assert(multi.maxRetries === 2, 'multi maxRetries should be 2')
assert(canManagerRetryMore({ ...multi, retryCount: 0, maxRetry: 3 }), 'multi retryCount=0 should allow retry')
assert(canManagerRetryMore({ ...multi, retryCount: 1, maxRetry: 3 }), 'multi retryCount=1 should allow retry (maxRetriesMulti=2)')
assert(!canManagerRetryMore({ ...multi, retryCount: 2, maxRetry: 3 }), 'multi retryCount=2 should block retry')

const single = resolveManagerRetryLimits({ retryCount: 0, intent: 'rag', plan: [{ agent: 'rag' }] })
assert(canManagerRetryMore({ ...single, retryCount: 0, maxRetry: 3 }), 'single retryCount=0 should allow')
assert(!canManagerRetryMore({ ...single, retryCount: 1, maxRetry: 3 }), 'single retryCount=1 should block')

// P0-3: probe 默认 12s
assert(dbProbeTimeoutMs() >= 12_000, 'db probe default >= 12s')
assert(ragProbeTimeoutMs() >= 12_000, 'rag probe default >= 12s')

// P1-2b: DB→图表快捷计划（默认开；MANAGER_DB_CHART_SHORTCUT=0 关闭）
assert(isDbChartShortcutEnabled(), 'db+chart shortcut should be on by default')
assert(
  shouldUseDbChartShortcut({
    intent: 'multi',
    question: '近7天 Top5 销售柱状图',
    constraints: { timeHints: [], subjectHints: [], wantsVisualize: true, wantsReport: false },
    probe: { db: { matched: true, tables: ['orders'] } },
    allowedAgents: ['db', 'visualize']
  }),
  'db+chart shortcut should match by default'
)
process.env.MANAGER_DB_CHART_SHORTCUT = '0'
assert(
  !shouldUseDbChartShortcut({
    intent: 'multi',
    question: '近7天 Top5 销售柱状图',
    constraints: { timeHints: [], subjectHints: [], wantsVisualize: true, wantsReport: false },
    probe: { db: { matched: true, tables: ['orders'] } },
    allowedAgents: ['db', 'visualize']
  }),
  'db+chart shortcut off when env=0'
)
delete process.env.MANAGER_DB_CHART_SHORTCUT
const steps = buildDbChartShortcutPlan({ intent: 'multi', question: 'Top5 销售' })
assert(steps.length === 2 && steps[0]?.agent === 'db' && steps[1]?.agent === 'visualize', 'shortcut plan shape')

// U3-3: 纯查库短路
assert(
  shouldUseDbOnlyShortcut({
    intent: 'multi',
    question: '在数据库中查询林婉清足底压力测试记录',
    intentClassify: mockIntentClassifyForTest({ isDbAnchored: true, planShortcut: 'db_only' }),
    probe: { db: { matched: true, tables: ['remote_activity_foot_log'] } },
    allowedAgents: ['db']
  }),
  'db-only shortcut should match simple db query'
)
const dbOnlySteps = buildDbOnlyShortcutPlan({
  intent: 'multi',
  question: '在数据库中查询林婉清足底压力测试记录'
})
assert(dbOnlySteps.length === 1 && dbOnlySteps[0]?.agent === 'db', 'db-only plan shape')
assert(
  !shouldUseDbOnlyShortcut({
    intent: 'multi',
    question: '查库林婉清足底压力数据，联网查同龄参考范围，写对比报告',
    intentClassify: mockIntentClassifyForTest({
      planShortcut: 'none',
      explicitWantsReport: true,
      isMulti: true,
      suggestedAgents: ['db', 'crawler', 'report']
    }),
    probe: { db: { matched: true, tables: ['foot'] } },
    allowedAgents: ['db', 'crawler', 'report']
  }),
  'db-only shortcut should not match multi-source report task'
)

// pipeline: visualize 必须 dependsOn code（Planner 已含 code 时）
const topoPlan = ensurePipelineDependsOn([
  { id: 'step_rag', agent: 'rag', query: '检索' },
  { id: 'step_code', agent: 'code', query: '计算' },
  { id: 'step_visualize', agent: 'visualize', query: '出图' }
] as const)
const vizStep = topoPlan.find((s) => s.agent === 'visualize')
assert(vizStep?.dependsOn?.includes('step_code'), 'visualize must depend on code step')
assert(!vizStep?.dependsOn?.includes('step_rag'), 'visualize must not depend on rag when code exists')

// prefetch: 跟路由 allowedAgents；probe 命中 alone 不触发
assert(
  resolvePrefetchTargets({ intent: 'multi', allowedAgents: ['db', 'report'] }).db,
  'router db should prefetch db'
)
assert(
  !resolvePrefetchTargets({ intent: 'multi', allowedAgents: ['db', 'report'] }).rag,
  'router db-only must not rag prefetch'
)
assert(
  resolvePrefetchTargets({ intent: 'multi', allowedAgents: ['rag', 'report'] }).rag,
  'router rag should prefetch rag'
)
assert(
  !resolvePrefetchTargets({ intent: 'multi', allowedAgents: ['rag', 'report'] }).db,
  'router rag-only must not db prefetch'
)
assert(
  !resolvePrefetchTargets({ intent: 'multi', allowedAgents: ['admin'] }).db &&
    !resolvePrefetchTargets({ intent: 'multi', allowedAgents: ['admin'] }).rag,
  'admin-only must skip prefetch'
)
assert(
  resolvePrefetchTargets({ intent: 'multi', allowedAgents: ['db', 'rag', 'report'] }).db &&
    resolvePrefetchTargets({ intent: 'multi', allowedAgents: ['db', 'rag', 'report'] }).rag,
  'router db+rag should prefetch both'
)
assert(
  resolvePrefetchTargets({ intent: 'db', allowedAgents: [] }).db &&
    !resolvePrefetchTargets({ intent: 'db', allowedAgents: [] }).rag,
  'empty allowedAgents falls back to intent=db'
)

// route: taskConstraints 补全 visualize
const supplemented = supplementAllowedFromTaskConstraints(['rag', 'report', 'admin'], {
  timeHints: [],
  subjectHints: [],
  wantsVisualize: true,
  wantsReport: true
}, {
  intentClassify: { explicitWantsVisualize: true, explicitWantsReport: true }
})
assert(supplemented.includes('visualize'), 'constraints should add visualize to allowedAgents')
assert(supplemented.includes('report'), 'constraints should retain report')

// route coverage: Planner 漏写 visualize 时按 allowedAgents 补步
const partialPlan = [
  { id: 'step_rag', agent: 'rag', query: '检索月度收支数据' },
  { id: 'step_code', agent: 'code', query: '计算收支对比数值' }
] as const
const coveredPlan = applyRoutePlanCoverage([...partialPlan], {
  question: '根据知识库生成收支对比图表',
  intent: 'multi',
  allowedCap: ['rag', 'code', 'visualize'],
  excerpt: '收支对比图表',
  constraints: {
    timeHints: [],
    subjectHints: [],
    fieldHints: [],
    wantsVisualize: true,
    wantsReport: false
  }
})
assert(
  coveredPlan.some((s) => s.agent === 'visualize'),
  'route coverage should add missing visualize step'
)
const vizAfterCoverage = coveredPlan.find((s) => s.agent === 'visualize')
assert(vizAfterCoverage?.dependsOn?.includes('step_code'), 'coverage-added visualize must depend on code')

// scheduler: report 须等 code 完成
const finPlan = [
  { id: 's1', agent: 'rag', query: 'q' },
  { id: 's2', agent: 'code', query: 'c', dependsOn: ['s1'] },
  { id: 's6', agent: 'report', query: 'r', dependsOn: ['s2'] }
] as const
assert(!isStepReadyForExecution(finPlan[2]!, [...finPlan], {}), 'report blocked before code')
assert(
  isStepReadyForExecution(finPlan[2]!, [...finPlan], { s2: { status: 'ok' } }),
  'report ready after code ok'
)
assert(
  !isStepReadyForExecution({ id: 's5', agent: 'visualize', query: 'v' }, finPlan, {}),
  'visualize without dependsOn blocked when plan has code'
)

// scheduler: 双取数并行，code 须等 rag+crawler 均完成
const fetchPlan = finalizePlanForExecution([
  { id: 's_rag', agent: 'rag', query: 'a' },
  { id: 's_crawl', agent: 'crawler', query: 'b' },
  { id: 's_code', agent: 'code', query: 'c' },
  { id: 's_viz', agent: 'visualize', query: 'd' }
])
const codeStep = fetchPlan.find((s) => s.agent === 'code')!
const parallelVizStep = fetchPlan.find((s) => s.agent === 'visualize')!
assert(!isStepReadyForExecution(codeStep, fetchPlan, {}), 'code blocked with no upstream')
assert(
  !isStepReadyForExecution(codeStep, fetchPlan, { s_rag: { status: 'ok' } }),
  'code blocked until all fetch agents done'
)
assert(
  isStepReadyForExecution(codeStep, fetchPlan, { s_rag: { status: 'ok' }, s_crawl: { status: 'ok' } }),
  'code ready after rag+crawler'
)
assert(
  !isStepReadyForExecution(parallelVizStep, fetchPlan, { s_rag: { status: 'ok' }, s_crawl: { status: 'ok' } }),
  'visualize blocked until code completes'
)
assert(
  isStepReadyForExecution(parallelVizStep, fetchPlan, {
    s_rag: { status: 'ok' },
    s_crawl: { status: 'ok' },
    s_code: { status: 'ok' }
  }),
  'visualize ready after code'
)

// P1-5: composeFinal 共用
const composed = composeFinalFromGraphResult({ final: '汇总', results: { db: '42 rows' } })
assert(composed.includes('汇总') || composed.includes('42'), 'composeFinal picks synth or agent output')
const ck = buildHumanConfirmCheckpoint({ intent: 'multi', plan: [{ agent: 'admin' }] })
assert((ck as { intent?: string }).intent === 'multi', 'checkpoint builder')

// P0-5: 结构化错误
const err = buildAgentError({ agent: 'db', message: 'connect ECONNREFUSED', phase: 'execute' })
assert(err.retryable && err.agent === 'db', 'agent error retryable heuristic')

// P0 CleanPayload：组装、解析、Code 优先读 clean
const snapDb = {
  agent: 'db' as const,
  raw: '{"facts":[{"key":"pressure_left","value":120}]}',
  answer: 'db ok',
  facts: [{ key: 'pressure_left', value: 120, sourcePath: 'db.pressure_left' }]
}
const snapRag = {
  agent: 'rag' as const,
  raw: '{"facts":[{"key":"ref_max","value":130}]}',
  answer: 'rag ok',
  facts: [{ key: 'ref_max', value: 130, sourcePath: 'rag.ref_max' }]
}
const aligned = assembleCleanPayload([snapDb, snapRag], {
  field_mappings: [
    { canonical_key: 'pressure_left', source_key: 'pressure_left', source_agent: 'db', value: 120, confidence: 0.9 },
    { canonical_key: 'ref_max', source_key: 'ref_max', source_agent: 'rag', value: 130, confidence: 0.88 }
  ],
  alignments: [{ left: 'db.pressure_left', right: 'rag.ref_max', relation: 'compare' }],
  confidence: 0.9
})
assert(aligned?.facts.length === 2, 'assembleCleanPayload should merge two sources')
const serialized = serializeCleanPayload(aligned!)
const roundTrip = parseCleanPayload(serialized)
assert(roundTrip?.facts.length === 2 && roundTrip.data.mode === 'multi_source_aligned', 'CleanPayload round-trip')

const structural = assembleCleanPayloadStructural([snapDb, snapRag])
assert(structural?.facts.length === 2 && structural.data.mode === 'multi_source_structural', 'structural multi-source clean')

const multiResults = {
  db: '{"answer":"a","facts":[{"key":"x","value":1}]}',
  rag: '{"answer":"b","facts":[{"key":"y","value":2}]}',
  clean: serialized
}
const codeFacts = buildStructuredFactsFromResults(multiResults)
assert(codeFacts.length === 2 && codeFacts.every((f) => f.agent === 'clean'), 'Code facts prefer clean payload')
const upstream = buildUpstreamContextFromResults(multiResults)
assert(upstream.includes('clean:') && !upstream.includes('rag:'), 'upstream context should only use clean when present')

const snaps = parseSourceSnapshots(
  { db: '{"facts":[{"key":"a","value":1}]}', rag: '{"facts":[{"key":"b","value":2}]}' },
  extractStructuredPayload
)
assert(snaps.length === 2 && activeDataSources({ db: 'x', rag: 'y' }).length === 2, 'source snapshots')

const insuff = assessDataSufficiencyStructural({ factsCount: 1, wantsVisualize: true })
assert(!insuff.sufficient && insuff.gapMessage.length > 0, 'visualize needs >=2 facts')

const renderableViz = [
  'chart',
  '<!--ECHARTS_OPTION-->',
  JSON.stringify({ title: { text: 't' }, series: [{ type: 'bar', data: [1, 2] }] }),
  '<!--/ECHARTS_OPTION-->'
].join('\n')
assert(isVisualizeOutputRenderable(renderableViz), 'chart validator accepts minimal bar')
assert(!isVisualizeOutputRenderable('no chart here'), 'chart validator rejects missing block')

console.log('smoke: p0 upgrades ok')
