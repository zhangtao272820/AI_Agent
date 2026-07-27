/**
 * U3-3 计划短路回归（纯函数，不拉 LangGraph / storage）。
 */
import {
  buildDbOnlyShortcutPlan,
  buildRagOnlyShortcutPlan,
  coalesceSimpleDbRoute,
  coalesceSimpleRagRoute,
  shouldUseDbOnlyShortcut,
  shouldUseAdminOnlyShortcut,
  shouldUseRagOnlyShortcut,
  buildAdminOnlyShortcutPlan
} from '../../../server/graph/core/plan/planShortcuts'
import { mockIntentClassifyForTest } from '../../../server/graph/llm/intentClassifyLlm'
import { coerceConstraintsForSimpleDbQuery, coerceConstraintsForSimpleRagQuery } from '../../../server/utils/db/managerDbSchemaHintsPolicy'
import { shouldOmitManagerDbSchemaHints } from '../../../server/utils/db/managerDbSchemaHintsPolicy'
import { looksLikeSimpleRagKbQuery } from '../../../server/graph/core/plan/clarifyContext'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

const dbQuery = '在数据库中查询林婉清足底压力测试记录'
const dbProbe = { db: { matched: true, tables: ['remote_activity_foot_log'] } }
const dbClassify = mockIntentClassifyForTest({ isDbAnchored: true, planShortcut: 'db_only' })

assert(
  shouldUseDbOnlyShortcut({
    intent: 'multi',
    question: dbQuery,
    userMessage: dbQuery,
    probe: dbProbe,
    allowedAgents: ['db', 'rag', 'report'],
    routerLlmAllowed: ['db'],
    intentClassify: dbClassify
  }),
  'db-only shortcut matches user db query'
)

assert(
  shouldUseDbOnlyShortcut({
    intent: 'multi',
    question: dbQuery,
    userMessage: dbQuery,
    routedQuery: '查询林婉清足底压力并获取慢性病与健康档案写报告',
    probe: dbProbe,
    allowedAgents: ['db', 'rag', 'report'],
    routerLlmAllowed: ['db'],
    intentClassify: dbClassify
  }),
  'db-only shortcut uses userMessage over hallucinated routedQuery'
)

const coalesced = coalesceSimpleDbRoute({
  intent: 'multi',
  question: dbQuery,
  userMessage: dbQuery,
  probe: dbProbe,
  allowedAgents: ['db', 'report'],
  routerLlmAllowed: ['db'],
  intentClassify: dbClassify
})
assert(coalesced?.intent === 'db' && coalesced.allowedAgents.join() === 'db', 'route coalesce to db')

const steps = buildDbOnlyShortcutPlan({
  intent: 'db',
  question: dbQuery,
  userMessage: dbQuery
})
assert(steps.length === 1 && steps[0]?.agent === 'db', 'db-only plan is single step')

assert(
  !shouldUseDbOnlyShortcut({
    intent: 'multi',
    question: '查库林婉清足底压力，联网查参考范围，写对比报告',
    userMessage: '查库林婉清足底压力，联网查参考范围，写对比报告',
    probe: dbProbe,
    allowedAgents: ['db', 'crawler', 'report'],
    intentClassify: mockIntentClassifyForTest({
      isDbAnchored: true,
      planShortcut: 'none',
      explicitWantsReport: true,
      isMulti: true,
      suggestedAgents: ['db', 'crawler', 'report']
    })
  }),
  'db-only shortcut rejects multi-source report task'
)

const mapQ = '公交从这到天津西站多久'
const adminClassify = mockIntentClassifyForTest({
  primaryIntent: 'admin',
  isMulti: false,
  suggestedAgents: ['admin'],
  isDbAnchored: false,
  needsAdmin: true,
  planShortcut: 'admin_only'
})
assert(
  shouldUseAdminOnlyShortcut({
    intent: 'multi',
    question: mapQ,
    userMessage: mapQ,
    allowedAgents: ['admin'],
    intentClassify: adminClassify
  }),
  'admin-only shortcut matches map route question'
)
const adminPlan = buildAdminOnlyShortcutPlan({ intent: 'admin', question: mapQ })
assert(adminPlan.length === 1 && adminPlan[0]?.agent === 'admin', 'admin-only plan shape')
assert(adminPlan[0]?.query === mapQ, 'admin-only plan keeps user map text')

const tcmQuery = '在数据库中查询叶梓萱的中医就诊记录'
const tcmClassify = mockIntentClassifyForTest({ isDbAnchored: true, explicitWantsReport: false })
const coerced = coerceConstraintsForSimpleDbQuery(
  { timeHints: [], subjectHints: ['叶梓萱'], fieldHints: [], wantsVisualize: false, wantsReport: true },
  tcmQuery,
  { intentClassify: tcmClassify }
)
assert(!coerced.wantsReport, 'coerce clears false-positive wantsReport on db query')

assert(
  shouldUseDbOnlyShortcut({
    intent: 'multi',
    question: tcmQuery,
    userMessage: tcmQuery,
    probe: dbProbe,
    allowedAgents: ['db', 'report'],
    routerLlmAllowed: ['db'],
    constraints: coerced,
    intentClassify: tcmClassify
  }),
  'tcm db query uses db-only shortcut after constraint coerce'
)

assert(
  shouldOmitManagerDbSchemaHints({
    question: tcmQuery,
    lastUser: tcmQuery,
    intent: 'db',
    intentClassify: tcmClassify
  }),
  'simple db query omits manager schema hints'
)

const ragQuery = '在知识库中查询神能满足度压力测试和卡失能老人行走时长分别是多少？'
const ragClassify = mockIntentClassifyForTest({
  primaryIntent: 'rag',
  isMulti: false,
  suggestedAgents: ['rag'],
  isDbAnchored: false,
  planShortcut: 'rag_only'
})
const ragCoerced = coerceConstraintsForSimpleRagQuery(
  { timeHints: [], subjectHints: [], fieldHints: [], wantsVisualize: false, wantsReport: true },
  ragQuery,
  { intentClassify: ragClassify }
)
assert(!ragCoerced.wantsReport, 'coerce clears false-positive wantsReport on rag query')

assert(
  shouldUseRagOnlyShortcut({
    intent: 'multi',
    question: ragQuery,
    userMessage: ragQuery,
    allowedAgents: ['rag', 'clean', 'code', 'report'],
    routerLlmAllowed: ['rag'],
    constraints: ragCoerced,
    intentClassify: ragClassify
  }),
  'rag-only shortcut matches multi-value kb lookup'
)

const ragCoalesced = coalesceSimpleRagRoute({
  intent: 'multi',
  question: ragQuery,
  userMessage: ragQuery,
  allowedAgents: ['rag', 'clean', 'code', 'report'],
  routerLlmAllowed: ['rag'],
  constraints: ragCoerced,
  intentClassify: ragClassify
})
assert(ragCoalesced?.intent === 'rag' && ragCoalesced.allowedAgents.join() === 'rag', 'route coalesce to rag')

const ragSteps = buildRagOnlyShortcutPlan({
  intent: 'rag',
  question: ragQuery,
  userMessage: ragQuery
})
assert(ragSteps.length === 1 && ragSteps[0]?.agent === 'rag', 'rag-only plan is single step')

const financeQuery = '在知识库中查询我的月度财务状况'
const financeClassify = mockIntentClassifyForTest({
  primaryIntent: 'rag',
  isMulti: false,
  suggestedAgents: ['rag'],
  isDbAnchored: false,
  planShortcut: 'rag_only',
  explicitWantsReport: false
})
const financeCoerced = coerceConstraintsForSimpleRagQuery(
  { timeHints: [], subjectHints: [], fieldHints: [], wantsVisualize: false, wantsReport: true },
  financeQuery,
  { intentClassify: financeClassify }
)
assert(!financeCoerced.wantsReport, 'monthly finance kb query clears false-positive wantsReport')
assert(
  shouldUseRagOnlyShortcut({
    intent: 'multi',
    question: financeQuery,
    userMessage: financeQuery,
    allowedAgents: ['rag', 'clean', 'code', 'report'],
    routerLlmAllowed: ['rag'],
    constraints: financeCoerced,
    intentClassify: financeClassify
  }),
  'monthly finance kb query uses rag-only shortcut'
)
const financeSteps = buildRagOnlyShortcutPlan({
  intent: 'rag',
  question: financeQuery,
  userMessage: financeQuery
})
assert(financeSteps.length === 1 && financeSteps[0]?.agent === 'rag', 'monthly finance plan is single rag step')

assert(looksLikeSimpleRagKbQuery(financeQuery), 'finance query is simple rag kb')
const pollutedCoalesce = coalesceSimpleRagRoute({
  intent: 'multi',
  question: financeQuery,
  userMessage: financeQuery,
  allowedAgents: ['rag', 'clean', 'code', 'report'],
  routerLlmAllowed: ['rag'],
  constraints: financeCoerced
})
assert(pollutedCoalesce?.intent === 'rag' && pollutedCoalesce.allowedAgents.join() === 'rag', 'router rag-only coalesce despite polluted cap list')

assert(
  !shouldUseRagOnlyShortcut({
    intent: 'multi',
    question: '从知识库取财务数据画对比图并写分析报告',
    userMessage: '从知识库取财务数据画对比图并写分析报告',
    allowedAgents: ['rag', 'visualize', 'report'],
    intentClassify: mockIntentClassifyForTest({
      primaryIntent: 'multi',
      isMulti: true,
      suggestedAgents: ['rag', 'clean', 'code', 'visualize', 'report'],
      planShortcut: 'none',
      explicitWantsReport: true,
      explicitWantsVisualize: true
    })
  }),
  'rag-only shortcut rejects kb chart/report task'
)

console.log('smoke: plan shortcuts ok')
