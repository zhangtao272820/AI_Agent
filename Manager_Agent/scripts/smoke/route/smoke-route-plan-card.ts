import { buildRoutePlanCardPayload, isRoutePlanCardEnabled } from '../../../server/graph/core/routing/routePlanCard'
import type { OrchestratorDecision } from '../../../server/graph/orchestrate/orchestratorInvariants'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

assert(isRoutePlanCardEnabled(), 'MANAGER_ROUTE_PLAN_CARD should default on')

const decision = {
  intent: 'multi',
  allowedAgents: ['rag', 'db', 'clean', 'code', 'visualize'],
  routedQuery: '知识库+数据库汇总出图',
  needsWebSearch: false,
  clauses: [
    { id: 'c1', text: '知识库查养老机构规范', agents: ['rag'] },
    { id: 'c2', text: '数据库查老人总数', agents: ['db'] }
  ],
  intentClassify: {
    dataSources: ['rag', 'db'],
    requiresAgentPipeline: true,
    confidence: 0.88,
    rationale: '复合任务'
  },
  planBlueprint: {
    rationale: 'test',
    confidence: 0.85,
    steps: [
      { agent: 'rag', queryFocus: '养老机构规范要点' },
      { agent: 'db', queryFocus: '老人总数' },
      { agent: 'clean', queryFocus: '合并' },
      { agent: 'code', queryFocus: '对比' },
      { agent: 'visualize', queryFocus: '出图' }
    ]
  }
} as OrchestratorDecision

const card = buildRoutePlanCardPayload({
  decision,
  orchestratorSource: 'full_llm',
  lintIssues: ['cap 含 clean 但用户未要求清洗/规整'],
  judgeRationale: '子句与 cap 一致',
  judgeAccept: true,
  runId: 'smoke-run'
})

assert(card.agents.includes('rag') && card.agents.includes('db'), 'cap agents')
assert(card.clauses.length >= 2, 'clauses')
assert(card.blueprintSteps.length >= 3, 'blueprint steps')
assert(card.blueprintDag.length > 0 && card.blueprintDag.includes('rag'), 'blueprint dag')
assert(card.dataSources.includes('rag'), 'dataSources')
assert(card.lintSeverity === 'warn', 'spurious lint warn')

console.log('smoke-route-plan-card: OK')
