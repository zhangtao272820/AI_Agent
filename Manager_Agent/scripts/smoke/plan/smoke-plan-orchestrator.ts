/**
 * LLMCompiler 式编排：validate + Task Fetching Unit + 硬规则（clean/code/等待上游）
 */
import { validateAndPreparePlan, assertPlanDagAcyclic } from '../../../server/graph/core/plan/planValidate'
import {
  isStepReadyForExecution,
  resolveEffectiveDependencies
} from '../../../server/graph/core/plan/planParallel'
import { canCoalesceRouteToSingleSource, countDistinctExecutionAgents } from '../../../server/graph/core/routing/routeAuthority'
import { mockIntentClassifyForTest } from '../../../server/graph/llm/intentClassifyLlm'
import { selectReadySteps } from '../../../server/graph/core/task/taskFetcher'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

const comboCap = ['rag', 'visualize', 'admin', 'code', 'clean'] as const
const comboPlan = [
  { id: 's_rag', agent: 'rag' as const, query: '检索月度财务' },
  { id: 's_admin', agent: 'admin' as const, query: '创建明天10点会议并提醒' },
  { id: 's_viz', agent: 'visualize' as const, query: '生成对比图' }
]

const validated = validateAndPreparePlan([...comboPlan], {
  excerpt: '知识库查财务并出对比图，同时创建会议',
  allowedCap: [...comboCap]
})
const agents = validated.map((s) => s.agent)
assert(validated.some((s) => s.agent === 'clean'), `must insert clean: ${agents.join('→')}`)
assert(validated.some((s) => s.agent === 'code'), `must insert code for viz: ${agents.join('→')}`)
assert(validated.some((s) => s.agent === 'admin'), `must keep admin: ${agents.join('→')}`)

const acyclic = assertPlanDagAcyclic(validated)
assert(acyclic.ok, `plan must be DAG: ${acyclic.cycle?.join(',')}`)

const rag = validated.find((s) => s.agent === 'rag')!
const clean = validated.find((s) => s.agent === 'clean')!
const code = validated.find((s) => s.agent === 'code')!
const viz = validated.find((s) => s.agent === 'visualize')!
const admin = validated.find((s) => s.agent === 'admin')!

assert(clean.dependsOn?.includes('s_rag'), 'clean waits rag')
assert(code.dependsOn?.includes(String(clean.id)), 'code waits clean')
assert(viz.dependsOn?.includes(String(code.id)), 'viz waits code')

const wave0 = selectReadySteps(validated, validated, {})
assert(wave0.some((s) => s.agent === 'rag'), 'rag ready at start')
assert(wave0.some((s) => s.agent === 'admin'), 'admin parallel with rag at start')

const comboWithBadDbDep = validateAndPreparePlan(
  [
    { id: 's_rag', agent: 'rag' as const, query: '检索配比标准' },
    { id: 's_db', agent: 'db' as const, query: '查河西区老人数量', dependsOn: ['s_admin'] },
    { id: 's_admin', agent: 'admin' as const, query: '查天津天气' }
  ],
  { excerpt: '知识库查配比，数据库查人数，查天气', allowedCap: ['rag', 'db', 'admin', 'clean', 'code', 'report'] }
)
const dbStep = comboWithBadDbDep.find((s) => s.agent === 'db')!
const adminStep = comboWithBadDbDep.find((s) => s.agent === 'admin')!
assert(!dbStep.dependsOn?.includes(String(adminStep.id)), `db must not depend on admin: ${dbStep.dependsOn?.join(',')}`)
const waveFetch = selectReadySteps(comboWithBadDbDep, comboWithBadDbDep, {})
assert(
  waveFetch.some((s) => s.agent === 'db') && waveFetch.some((s) => s.agent === 'admin'),
  `db+admin should be ready together: ${waveFetch.map((s) => s.agent).join(',')}`
)
assert(!wave0.some((s) => s.agent === 'clean'), 'clean blocked before rag')
assert(!isStepReadyForExecution(code, validated, { s_rag: { status: 'ok' } }), 'code blocked before clean')

const authorityBlock = canCoalesceRouteToSingleSource({
  routerLlmAllowed: ['rag', 'visualize', 'admin'],
  clauseAgents: ['admin'],
  intentClassify: mockIntentClassifyForTest({ isMulti: true, planShortcut: 'none' })
})
assert(!authorityBlock, 'multi agent must not coalesce to single source')
assert(countDistinctExecutionAgents({ routerLlmAllowed: ['rag', 'admin'] }) >= 2, 'count distinct agents')

console.log('smoke: plan orchestrator ok')
