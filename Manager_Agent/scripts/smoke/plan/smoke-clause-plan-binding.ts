/**
 * 子句 → 计划结构化绑定：Planner 漏 admin 时 repair；rag+viz 拓扑补 clean/code。
 */
import {
  mergePlanWithClauseMaterialization,
  lintClausePlanCoverage
} from '../../../server/graph/core/routing/clausePlanBinding'
import { validateAndPreparePlan } from '../../../server/graph/core/plan/planValidate'
import { resolveEffectiveDependencies } from '../../../server/graph/core/plan/planParallel'
import type { TaskClause } from '../../../server/graph/core/routing/clauses'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

const comboClauses: TaskClause[] = [
  { id: 'c1', text: '查知识库财务制度', agents: ['rag'] },
  { id: 'c2', text: '画收入对比图', agents: ['visualize'] },
  { id: 'c3', text: '安排明天10点项目周会', agents: ['admin'] }
]

const plannerMissAdmin = [
  { id: 's1', agent: 'rag' as const, query: '检索财务制度', clauseIds: ['c1'] },
  {
    id: 's2',
    agent: 'visualize' as const,
    query: '生成收入对比柱状图',
    dependsOn: ['s1'],
    clauseIds: ['c2']
  }
]

const cap = ['rag', 'visualize', 'admin', 'code', 'clean'] as const
const excerpt = '查知识库财务制度、画收入对比图，并安排明天10点项目周会'

const issuesBefore = lintClausePlanCoverage(comboClauses, plannerMissAdmin, {
  excerpt,
  allowedAgents: [...cap]
})
assert(issuesBefore.length > 0, 'missing admin should lint-fail')

const bound = mergePlanWithClauseMaterialization(plannerMissAdmin, comboClauses, {
  excerpt,
  allowedAgents: [...cap]
})
assert(bound.repaired, 'should repair missing admin clause')
assert(bound.plan.some((s) => s.agent === 'admin'), 'admin step required')

const adminStep = bound.plan.find((s) => s.agent === 'admin')!
const adminDeps = resolveEffectiveDependencies(adminStep, bound.plan)
assert(!adminDeps.includes('s1'), 'standalone admin must not depend on rag')

const validated = validateAndPreparePlan(bound.plan, {
  excerpt,
  pipelineOpts: {
    question: excerpt,
    constraints: {
      timeHints: [],
      subjectHints: [],
      fieldHints: [],
      wantsVisualize: true,
      wantsReport: false
    }
  },
  allowedCap: [...cap]
})
const agents = validated.map((s) => s.agent)
assert(validated.some((s) => s.agent === 'clean'), `rag+viz must add clean: ${agents.join('→')}`)
assert(validated.some((s) => s.agent === 'code'), `viz must add code: ${agents.join('→')}`)

const roots = validated.filter((s) => resolveEffectiveDependencies(s, validated).length === 0)
const rootAgents = new Set(roots.map((s) => s.agent))
assert(rootAgents.has('rag') && rootAgents.has('admin'), `parallel roots rag+admin: ${[...rootAgents].join(',')}`)

console.log('smoke: clause-plan-binding ok')
