/**
 * Planner coverage：allowedAgents 为 cap，不得把污染列表变成必执行步骤。
 */
import { applyRoutePlanCoverage } from '../../../server/graph/core/plan'
import { reconcileRouteAllowedAgents } from '../../../server/graph/core/routing/clauses'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

const pollutedCap = ['rag', 'clean', 'code', 'report'] as const
const ragOnlyPlan = [{ id: 'step_rag', agent: 'rag' as const, query: '检索月度财务状况' }]

const covered = applyRoutePlanCoverage([...ragOnlyPlan], {
  question: '在知识库中查询我的月度财务状况',
  intent: 'multi',
  allowedCap: [...pollutedCap],
  excerpt: '在知识库中查询我的月度财务状况',
  constraints: {
    timeHints: [],
    subjectHints: [],
    fieldHints: [],
    wantsVisualize: false,
    wantsReport: false
  }
})
const agents = covered.map((s) => s.agent)
assert(agents.length === 1 && agents[0] === 'rag', `cap pollution must not expand plan: ${agents.join('→')}`)

const reconciled = reconcileRouteAllowedAgents([...pollutedCap], [])
assert(
  reconciled.join(',') === 'rag,clean,code,report',
  'route reconcile sorts only, no auto code/clean inject'
)

const vizPlan = [
  { id: 's1', agent: 'rag' as const, query: '取数' },
  { id: 's2', agent: 'visualize' as const, query: '出图' }
]
const vizCovered = applyRoutePlanCoverage([...vizPlan], {
  question: '从知识库取财务数据画对比图',
  intent: 'multi',
  allowedCap: ['rag', 'visualize', 'code'],
  constraints: {
    timeHints: [],
    subjectHints: [],
    fieldHints: [],
    wantsVisualize: true,
    wantsReport: false
  }
})
assert(vizCovered.some((s) => s.agent === 'code'), 'viz hard rule should add code')
assert(vizCovered.some((s) => s.agent === 'clean'), 'code+rag hard rule should add clean')
assert(!vizCovered.some((s) => s.agent === 'report'), 'no report unless user asked')

const ragCodePlan = [
  { id: 's1', agent: 'rag' as const, query: '取财务数据' },
  { id: 's2', agent: 'code' as const, query: '汇总计算' }
]
const ragCodeTopo = applyRoutePlanCoverage([...ragCodePlan], {
  question: '从知识库取数并汇总',
  intent: 'multi',
  allowedCap: ['rag', 'code', 'clean'],
  constraints: {
    timeHints: [],
    subjectHints: [],
    fieldHints: [],
    wantsVisualize: false,
    wantsReport: false
  }
})
const cleanStep = ragCodeTopo.find((s) => s.agent === 'clean')
const codeStep = ragCodeTopo.find((s) => s.agent === 'code')
assert(Boolean(cleanStep), 'rag+code must insert clean')
assert(
  cleanStep!.dependsOn?.includes('s1'),
  'clean must wait upstream rag'
)
assert(
  codeStep!.dependsOn?.includes(String(cleanStep!.id)),
  'code must wait clean not raw rag'
)

console.log('smoke: plan coverage ok')
