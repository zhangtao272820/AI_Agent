/**
 * 联网搜索 query 仅来自 crawler/media 子句；复合 rag+db+admin 不得整句入搜
 */
import { decomposeSearchQueries, hasWebSearchBoundClause } from '../../../server/utils/search/managerWebSearch'
import { resolveSearchPlan } from '../../../server/utils/search/managerSearchPlannerLlm'
import {
  lintOrchestratorBundle,
  orchestratorLintSeverity
} from '../../../server/graph/orchestrate/orchestratorStructuralLint'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`[smoke-search-clause-scope] ${msg}`)
}

const user =
  '知识库查失能老人补贴和高龄津贴标准，数据库查河西区70-79岁老人性别分布，写一份对比报告。并查一下天津明天的天气怎么样'

const noWebClauses = [
  { id: 'c1', text: '知识库查失能老人补贴和高龄津贴标准', agents: ['rag' as const] },
  { id: 'c2', text: '数据库查河西区70-79岁老人性别分布', agents: ['db' as const] },
  { id: 'c3', text: '查一下天津明天的天气怎么样', agents: ['admin' as const] },
  { id: 'c4', text: '写一份对比报告', agents: ['report' as const] }
]

assert(!hasWebSearchBoundClause(noWebClauses), 'no web-bound clause')
const emptyQs = decomposeSearchQueries(user, noWebClauses)
assert(emptyQs.length === 0, `multi-clause without crawler must not fallback to full utterance, got ${JSON.stringify(emptyQs)}`)

const withCrawler = [
  ...noWebClauses.slice(0, 2),
  { id: 'c5', text: '网上查最新民政部护理补贴通知原文', agents: ['crawler' as const] }
]
const crawlerQs = decomposeSearchQueries(user, withCrawler)
assert(crawlerQs.length === 1, 'only crawler clause')
assert(crawlerQs[0]!.includes('民政部'), 'crawler clause text')
assert(!crawlerQs.some((q) => q.includes('天气') || q === user), 'must not include weather or full user')

const plan = await resolveSearchPlan(user, null, noWebClauses)
assert(plan.plan.subQueries.length === 0, 'resolveSearchPlan empty without web clause')

const lintIssues = lintOrchestratorBundle({
  userTask: user,
  allowedAgents: ['rag', 'db', 'crawler', 'admin', 'code', 'report'],
  clauses: noWebClauses,
  classify: {
    primaryIntent: 'multi',
    isMulti: true,
    suggestedAgents: ['rag', 'db', 'crawler', 'admin', 'code', 'report'],
    isDbAnchored: true,
    needsAdmin: true,
    needsWeb: true,
    explicitWantsReport: true,
    explicitWantsVisualize: false,
    planShortcut: 'none',
    dataSources: ['rag', 'db', 'crawler'],
    requiresAgentPipeline: true,
    allowChatWebDirect: false,
    confidence: 0.8,
    rationale: 'bad mock with unbound crawler'
  } as any,
  planBlueprint: {
    rationale: 'bad',
    confidence: 0.7,
    steps: [
      { agent: 'rag', queryFocus: '知识库查失能老人补贴和高龄津贴标准' },
      { agent: 'db', queryFocus: '数据库查河西区70-79岁老人性别分布' },
      { agent: 'crawler', queryFocus: user },
      { agent: 'admin', queryFocus: '查一下天津明天的天气怎么样' },
      { agent: 'report', queryFocus: '写一份对比报告' }
    ]
  }
})
assert(
  lintIssues.some((i) => i.includes('无 crawler 子句') || i.includes('重复整段')),
  `lint must fail unbound crawler, got: ${lintIssues.join(';')}`
)
assert(orchestratorLintSeverity(lintIssues) === 'fail', 'severity fail')

console.log('smoke-search-clause-scope: OK')
