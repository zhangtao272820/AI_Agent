/**
 * 统一任务编排器 smoke（无 LLM）：不变量 + 知识库财务场景不得含 db
 */
import {
  parseOrchestratorForTest,
  parseOrchestratorPayloadForTest,
  buildProbeAnchoredOrchestratorFallback
} from '../../../server/graph/llm/taskOrchestrator'
import { coercePlanShortcut } from '../../../server/graph/llm/intentClassifyLlm'
import { isProbeDbRoutingRelevant } from '../../../server/graph/core/probe/probeInterpretation'
import { applyOrchestratorInvariants } from '../../../server/graph/orchestrate/orchestratorInvariants'
import { applyOrchestratorCapAlignment, adminExplicitlyRequested } from '../../../server/graph/core/agent/agentPollutionGuard'
import { alignAllowedAgentsWithDataPlane } from '../../../server/graph/orchestrate/routeOrchestration'
import { resolveTurnRoutingScope } from '../../../server/graph/core/routing/turnScope'
import { HumanMessage } from '@langchain/core/messages'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

const raw = {
  turnScopeMode: 'topic_shift' as const,
  directChitchatSynth: false,
  coalescedTask: '在知识库检索个人月度财务并结合公网指标生成图表',
  clauses: [
    { id: 'c1', text: '从知识库检索个人月度财务', agents: ['rag'] as const },
    { id: 'c2', text: '从公网检索家庭财务健康指标', agents: ['crawler'] as const },
    { id: 'c3', text: '对比分析并生成图表', agents: ['code', 'visualize'] as const }
  ],
  timeHints: [],
  subjectHints: ['我'],
  fieldHints: [],
  wantsVisualize: true,
  wantsReport: false,
  dataSources: ['rag', 'crawler'] as const,
  primaryIntent: 'multi' as const,
  isMulti: true,
  suggestedAgents: ['rag', 'crawler', 'clean', 'code', 'visualize'] as const,
  isDbAnchored: false,
  needsAdmin: false,
  needsWeb: true,
  explicitWantsReport: false,
  explicitWantsVisualize: true,
  planShortcut: 'none' as const,
  requiresAgentPipeline: true,
  allowChatWebDirect: false,
  intent: 'multi' as const,
  allowedAgents: ['rag', 'crawler', 'clean', 'code', 'visualize'] as const,
  routedQuery: '在知识库中检索个人月度财务情况，结合公网家庭财务健康指标做对比分析并生成图表',
  needsWebSearch: true,
  needsClarify: false,
  planBlueprint: {
    rationale: 'rag 与 crawler 并行后 clean→code→visualize',
    steps: [
      { agent: 'rag' as const, queryFocus: '检索知识库个人月度收支结余', clauseIds: ['c1'], parallelGroup: 'g1' },
      { agent: 'crawler' as const, queryFocus: '检索公网家庭财务健康指标区间', clauseIds: ['c2'], parallelGroup: 'g1' },
      { agent: 'clean' as const, queryFocus: '对齐 RAG 与爬虫数据', dependsOnAgents: ['rag', 'crawler'] as const },
      { agent: 'code' as const, queryFocus: '计算对比指标', dependsOnAgents: ['clean'] as const },
      { agent: 'visualize' as const, queryFocus: '生成对比图表', dependsOnAgents: ['code'] as const }
    ],
    confidence: 0.86
  },
  confidence: 0.88,
  rationale: '知识库+公网+图表'
}

const bundle = parseOrchestratorForTest(raw)
assert(bundle, 'parse orchestrator fixture')

const scope = resolveTurnRoutingScope({
  messages: [
    new HumanMessage('查数据库养老缴费'),
    new HumanMessage(raw.routedQuery)
  ],
  turnScopeLlm: { mode: 'topic_shift', directChitchatSynth: false, confidence: 0.9, rationale: '切换' }
})

const decision = applyOrchestratorInvariants({
  bundle: bundle!,
  turnScope: scope,
  state: { meta: {} },
  routerCapBaseline: ['db', 'rag', 'crawler', 'code', 'visualize']
})

assert(!decision.allowedAgents.includes('db'), `must strip db: ${decision.allowedAgents.join('→')}`)
assert(decision.intent === 'multi', 'composite pipeline is multi')
assert(decision.metaPatch.requiresAgentPipeline === true, 'pipeline flag')
assert(
  !decision.planBlueprint?.steps.some((s) => s.agent === 'db'),
  'blueprint must not contain db'
)

assert(
  !isProbeDbRoutingRelevant({ matched: true, tables: ['dify_knowledge_doc', 'dify_knowledge_doc_segment'] }),
  'RAG infra tables must not trigger db routing'
)

const probeFb = buildProbeAnchoredOrchestratorFallback({
  lastUser: raw.routedQuery,
  turnScope: scope,
  probe: {
    rag: { hits: 3 },
    db: { matched: true, tables: ['dify_knowledge_doc'] }
  }
})
assert(probeFb.intentClassify.dataSources?.length === 0, 'probe fallback must not pre-fill dataSources')

assert(coercePlanShortcut('rag_crawler', { dataSources: ['rag', 'crawler'], isMulti: true }) === 'none', 'rag_crawler → none')

const llmLike = parseOrchestratorPayloadForTest(
  {
    ...raw,
    planShortcut: 'rag_crawler',
    requiresAgentPipeline: true,
    allowChatWebDirect: false
  },
  raw.routedQuery
)
assert(llmLike, 'full JSON must accept rag_crawler after normalization')
assert(llmLike!.intentClassify.planShortcut === 'none', 'normalized planShortcut is none')

const pollutedAdmin = parseOrchestratorPayloadForTest(
  {
    ...raw,
    needsAdmin: true,
    suggestedAgents: ['rag', 'crawler', 'clean', 'code', 'visualize'],
    allowedAgents: ['rag', 'crawler', 'clean', 'code', 'visualize', 'admin'],
    planBlueprint: {
      rationale: '误加 admin',
      steps: [
        { agent: 'rag', queryFocus: '检索知识库个人月度收支结余' },
        { agent: 'crawler', queryFocus: '检索公网家庭财务健康指标区间' },
        { agent: 'admin', queryFocus: '创建会议日程' }
      ],
      confidence: 0.7
    }
  },
  raw.routedQuery
)
assert(pollutedAdmin, 'polluted admin fixture parses')
const adminDecision = applyOrchestratorInvariants({
  bundle: pollutedAdmin!,
  turnScope: scope,
  state: { meta: {} },
  routerCapBaseline: pollutedAdmin!.allowedAgents
})
assert(!adminDecision.allowedAgents.includes('admin'), `must strip spurious admin: ${adminDecision.allowedAgents.join('→')}`)
assert(
  !adminDecision.planBlueprint?.steps.some((s) => s.agent === 'admin'),
  'blueprint must drop admin step'
)
assert(!adminExplicitlyRequested({ classify: adminDecision.intentClassify }), 'needsAdmin alone must not count')

const adminAlign = alignAllowedAgentsWithDataPlane(
  ['db', 'crawler', 'code', 'report'],
  {
    primaryIntent: 'multi',
    isMulti: true,
    suggestedAgents: ['db', 'crawler', 'code', 'report'],
    isDbAnchored: true,
    needsAdmin: true,
    needsWeb: true,
    explicitWantsReport: true,
    explicitWantsVisualize: false,
    planShortcut: 'none',
    dataSources: ['db', 'crawler'],
    requiresAgentPipeline: true,
    allowChatWebDirect: false,
    confidence: 0.8,
    rationale: 'db+web+report without admin'
  },
  ['db', 'crawler', 'code', 'report']
)
assert(!adminAlign.includes('admin'), `align must not inject admin: ${adminAlign.join('→')}`)

const plantarQuery =
  '先从数据库中取出林婉清足底压力测试记录，再从公开网站检索同年龄段足底压力参考区间或指南摘要，对照后生成报告。'
const pollutedRag = parseOrchestratorPayloadForTest(
  {
    turnScopeMode: 'current_only',
    clauses: [{ id: 'c1', text: plantarQuery, agents: ['db', 'crawler', 'report'] }],
    dataSources: ['db', 'crawler'],
    primaryIntent: 'multi',
    isMulti: true,
    suggestedAgents: ['rag', 'db', 'crawler', 'clean', 'code', 'report'],
    isDbAnchored: true,
    needsAdmin: false,
    needsWeb: true,
    explicitWantsReport: true,
    explicitWantsVisualize: false,
    planShortcut: 'none',
    requiresAgentPipeline: true,
    allowChatWebDirect: false,
    intent: 'multi',
    allowedAgents: ['rag', 'db', 'crawler', 'clean', 'code', 'report'],
    routedQuery: plantarQuery,
    needsWebSearch: true,
    needsClarify: false,
    confidence: 0.85,
    rationale: 'LLM误加rag'
  },
  plantarQuery
)
assert(pollutedRag, 'plantar fixture parses')
const plantarDecision = applyOrchestratorInvariants({
  bundle: pollutedRag!,
  turnScope: { ...scope, lastOnly: plantarQuery, routingContext: plantarQuery },
  state: { meta: {} },
  routerCapBaseline: pollutedRag!.allowedAgents
})
assert(!plantarDecision.allowedAgents.includes('rag'), `db+web+report must strip rag: ${plantarDecision.allowedAgents.join('→')}`)
assert(plantarDecision.allowedAgents.includes('db'), 'must keep db')
assert(plantarDecision.allowedAgents.includes('crawler'), 'must keep crawler')
const capOnly = applyOrchestratorCapAlignment({
  allowed: ['rag', 'db', 'crawler', 'report', 'code', 'clean'],
  classify: plantarDecision.intentClassify,
  clauses: pollutedRag!.clauses,
  suggestedAgents: ['rag', 'db', 'crawler', 'clean', 'code', 'report']
})
assert(!capOnly.allowed.includes('rag'), 'dataSources without rag must strip rag')
assert(capOnly.allowed.includes('db') && capOnly.allowed.includes('crawler'), 'keep db+crawler')

const eastChinaTask =
  '检索华东重失能老人护理员配比标准，并从数据库统计华东大区近五年（2020-2024）老年人口估算按月列表'
const overweightHints = parseOrchestratorPayloadForTest(
  {
    turnScopeMode: 'current_only',
    clauses: [
      { id: 'c1', text: '检索华东重失能老人护理员配比标准', agents: ['rag'] },
      { id: 'c2', text: '统计华东大区近五年老年人口估算按月列表', agents: ['db', 'code'] }
    ],
    timeHints: ['2020', '2021', '2022', '2023', '2024'],
    subjectHints: ['华东', '重失能老人', '老年人口', '护理员配比', '华东大区'],
    fieldHints: ['配比', '人口', '按月', '估算', '标准', '统计', '列表'],
    dataSources: ['rag', 'db'],
    suggestedAgents: ['rag', 'db', 'clean', 'code', 'report'],
    allowedAgents: ['rag', 'db', 'clean', 'code', 'report'],
    isDbAnchored: true,
    isMulti: true,
    requiresAgentPipeline: true,
    routedQuery: eastChinaTask,
    planBlueprint: {
      steps: [
        { agent: 'rag', queryFocus: '检索华东重失能老人护理员配比标准' },
        { agent: 'db', queryFocus: '统计华东大区老年人口按月估算' },
        {
          agent: 'report',
          queryFocus: '汇总配比与人口按月列表',
          dependsOnAgents: ['rag', 'db', 'clean', 'code', 'visualize', 'admin', 'crawler']
        }
      ]
    }
  },
  eastChinaTask
)
assert(overweightHints, 'overweight hint arrays must normalize instead of schema-fail')
assert((overweightHints!.raw.timeHints?.length ?? 0) <= 8, 'timeHints bounded')
assert(
  (overweightHints!.raw.planBlueprint?.steps?.[2]?.dependsOnAgents?.length ?? 0) <= 6,
  'dependsOnAgents bounded'
)

const singleClauseOverflow = parseOrchestratorPayloadForTest(
  {
    clauses: [{ id: 'c1', text: eastChinaTask, agents: ['rag', 'db', 'clean', 'code', 'report'] }],
    dataSources: ['rag', 'db'],
    suggestedAgents: ['rag', 'db', 'clean', 'code', 'report'],
    allowedAgents: ['rag', 'db', 'clean', 'code', 'report'],
    isDbAnchored: true,
    routedQuery: eastChinaTask
  },
  eastChinaTask
)
assert(singleClauseOverflow, 'single clause agent overflow must clamp')
assert((singleClauseOverflow!.raw.clauses[0]?.agents?.length ?? 0) <= 4, 'clause agents bounded')

console.log('smoke-unified-orchestrator: OK')
