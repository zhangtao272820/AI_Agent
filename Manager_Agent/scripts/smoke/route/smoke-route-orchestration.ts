/**
 * 路由编排 smoke：数据面对齐、流水线门禁、复合 rag+web、聊天式联网拦截（无 LLM）
 */
import {
  alignAllowedAgentsWithDataPlane,
  ensureMultiIntentForPipeline,
  inferDataSourcesFromClassify,
  reconcileIntentClassifyDataPlane,
  requiresAgentPipelineExecution,
  shouldBlockDbOnlyCoalesce,
  stripDbUnlessDbAnchored,
  userRequiresDbDataPlane
} from '../../../server/graph/orchestrate/routeOrchestration'
import {
  applyCompositeRouteGuard,
  inferCompositeRouteStructural,
  reconcileCompositeGuardWithClassify,
  webExecutionModeFromCompositeGuard
} from '../../../server/utils/route/managerCompositeRouteGuardLlm'
import { shouldForceChatWebDirectSynth } from '../../../server/utils/chat/managerChatWeb'
import { canCandidateWebDirectSynth } from '../../../server/utils/search/managerWebDirectSynthLlm'
import { shouldUseDbOnlyShortcut } from '../../../server/graph/core/plan/planShortcuts'
import { resolveTurnRoutingScope } from '../../../server/graph/core/routing/turnScope'
import { HumanMessage } from '@langchain/core/messages'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

const ragWebIc = {
  primaryIntent: 'rag' as const,
  isMulti: true,
  suggestedAgents: ['rag', 'crawler', 'code', 'visualize'] as const,
  isDbAnchored: false,
  needsAdmin: false,
  needsWeb: true,
  explicitWantsReport: false,
  explicitWantsVisualize: true,
  planShortcut: 'none' as const,
  dataSources: ['rag', 'crawler'] as const,
  requiresAgentPipeline: true,
  allowChatWebDirect: false,
  confidence: 0.88,
  rationale: '知识库财务+公网指标+图表'
}

assert(shouldBlockDbOnlyCoalesce(ragWebIc), 'rag kb must block db_only coalesce')
assert(
  inferDataSourcesFromClassify(ragWebIc).join(',') === 'rag,crawler',
  'dataSources from classify'
)

const aligned = alignAllowedAgentsWithDataPlane(
  ['db', 'rag', 'crawler', 'code', 'visualize'],
  ragWebIc,
  ['db', 'rag', 'crawler', 'code', 'visualize']
)
assert(!aligned.includes('db'), `spurious db removed: ${aligned.join('→')}`)
assert(aligned.includes('rag') && aligned.includes('crawler'), 'keep rag+crawler')

const pipeline = requiresAgentPipelineExecution(ragWebIc, aligned)
assert(pipeline, 'composite kb+web+chart requires pipeline')

assert(
  ensureMultiIntentForPipeline('crawler', aligned, pipeline) === 'multi',
  'pipeline forces multi intent'
)

const composite = inferCompositeRouteStructural({
  intentClassify: ragWebIc,
  allowedAgents: ['rag', 'crawler']
})
assert(composite?.isCompositeDataWeb === true, 'rag+web structural composite')
assert(composite?.dataAgents?.includes('rag'), 'composite data agent is rag not db')
assert(composite?.webExecution === 'crawl', 'chart task needs crawl not serp_only')

const crawlMode = webExecutionModeFromCompositeGuard(composite!.webExecution, composite!.rationale)
assert(crawlMode?.mode === 'search_then_crawl', 'chart composite → search_then_crawl')
assert(crawlMode?.serpSummaryEnough === false, 'chart composite not serpSummaryEnough')

const dbWebReportIc = {
  primaryIntent: 'db' as const,
  isMulti: true,
  suggestedAgents: ['db', 'crawler', 'report'] as const,
  isDbAnchored: true,
  needsAdmin: false,
  needsWeb: true,
  explicitWantsReport: true,
  explicitWantsVisualize: false,
  planShortcut: 'none' as const,
  dataSources: ['db', 'crawler'] as const,
  requiresAgentPipeline: true,
  allowChatWebDirect: false,
  confidence: 0.9,
  rationale: '库内足底压力 + 公网参考对照 + 报告'
}

const dbComposite = inferCompositeRouteStructural({
  intentClassify: dbWebReportIc,
  allowedAgents: ['db', 'crawler', 'report']
})
assert(dbComposite?.isCompositeDataWeb === true, 'db+web structural composite')
assert(dbComposite?.webExecution === 'serp_summary', 'db+web report uses serp_summary')

const dbPipeline = requiresAgentPipelineExecution(dbWebReportIc, ['db', 'crawler', 'report'])
assert(dbPipeline, 'db+web+report still needs agent pipeline')

const appliedDb = applyCompositeRouteGuard({
  intent: 'multi',
  allowedAgents: ['db', 'crawler', 'report'],
  llmNeedsWebSearch: true,
  guard: dbComposite,
  intentClassify: dbWebReportIc
})
assert(appliedDb.compositeDataWebRoute, 'applied composite')
assert(appliedDb.webExecution === 'serp_summary', 'applied webExecution serp_summary')

const serpMode = webExecutionModeFromCompositeGuard(appliedDb.webExecution, dbComposite!.rationale)
assert(serpMode?.mode === 'search_serp_only', 'pipeline must NOT force crawl for serp_summary')
assert(serpMode?.serpSummaryEnough === true, 'serp_summary → serpSummaryEnough')
assert(
  !(dbPipeline && serpMode?.mode === 'search_then_crawl'),
  'regression: pipeline must not kidnap web leg to search_then_crawl'
)

assert(
  !shouldForceChatWebDirectSynth({
    requiresAgentPipeline: true,
    allowChatWebDirect: false,
    chatWebOnly: true,
    webExecutionMode: { mode: 'search_serp_only', primaryAgent: 'crawler', needsWebSearch: true }
  }),
  'chat web blocked when pipeline required'
)

assert(
  !canCandidateWebDirectSynth({
    intent: 'multi',
    allowedAgents: ['rag', 'crawler', 'code'],
    needsWebSearch: true,
    searchHits: [{ title: 't', url: 'https://x', snippet: 's' }],
    requiresAgentPipeline: true
  }),
  'direct synth candidate blocked for pipeline'
)

assert(
  !shouldUseDbOnlyShortcut({
    intent: 'db',
    question: '知识库月度财务',
    routedQuery: '知识库月度财务',
    userMessage: '知识库月度财务',
    allowedAgents: ['db'],
    routerLlmAllowed: ['db'],
    probe: { db: { matched: true, tables: ['t'] } },
    intentClassify: ragWebIc
  }),
  'plan shortcut db_only blocked for rag classify'
)

const reconciled = reconcileIntentClassifyDataPlane({
  ...ragWebIc,
  isDbAnchored: true,
  primaryIntent: 'db',
  suggestedAgents: ['db', 'rag', 'crawler'],
  dataSources: ['rag', 'crawler']
})
assert(!reconciled.isDbAnchored && reconciled.primaryIntent === 'rag', 'reconcile clears spurious db anchor')

const badComposite = reconcileCompositeGuardWithClassify(
  {
    isCompositeDataWeb: true,
    dataAgents: ['db'],
    webExecution: 'serp_summary',
    suggestedAgents: ['db', 'rag', 'crawler', 'code'],
    forbidGui: true,
    needsWebSearch: true,
    confidence: 0.8,
    rationale: '误把知识库当业务库'
  },
  ragWebIc
)
assert(!badComposite.dataAgents.includes('db'), 'composite guard strips db for rag kb')
assert(badComposite.dataAgents.includes('rag'), 'composite keeps rag')

assert(
  !stripDbUnlessDbAnchored(['db', 'rag', 'crawler', 'code'], ragWebIc).includes('db'),
  'strip db when not anchored'
)
assert(
  stripDbUnlessDbAnchored(['db'], { ...ragWebIc, isDbAnchored: true, primaryIntent: 'db', dataSources: ['db'] }).includes('db'),
  'keep db when anchored'
)
assert(!userRequiresDbDataPlane(ragWebIc), 'rag kb does not require db plane')

const pensionThenFinance = [
  new HumanMessage('查数据库里养老缴费记录'),
  new HumanMessage(
    '在知识库中检索个人月度财务情况，再从公开网站检索家庭财务健康度的常见指标与对照区间，结合我本人的月收入、支出与结余做简要分析，并生成图表。'
  )
]
const financeScope = resolveTurnRoutingScope({
  messages: pensionThenFinance,
  turnScopeLlm: {
    mode: 'continuation',
    directChitchatSynth: false,
    confidence: 0.85,
    rationale: '误承财务'
  },
  sessionAnchor: {
    primaryIntent: 'db',
    planShortcut: 'db_only',
    suggestedAgents: ['db'],
    isDbAnchored: true,
    isMulti: false,
    coalescedTask: '养老缴费',
    updatedAt: new Date().toISOString()
  }
})
assert(
  financeScope.mode === 'topic_shift',
  `long self-contained finance query must not continuation: ${financeScope.mode}`
)
assert(financeScope.suppressMultiTurnMerge, 'topic_shift suppresses merge')

console.log('smoke-route-orchestration: OK')
