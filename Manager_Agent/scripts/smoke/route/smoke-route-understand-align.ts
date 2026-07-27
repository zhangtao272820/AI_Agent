/**
 * 路由理解对齐 + 执行蓝图格式化（无 LLM，纯结构 smoke）
 */
import { alignAllowedAgentsWithUnderstanding, describeAllowedAgentDelta } from '../../../server/graph/core/routing/routeUnderstandAlign'
import { formatPlanBlueprintForPrompt, parsePlanBlueprintForTest } from '../../../server/graph/llm/planBlueprintLlm'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

// 路由 LLM 漏 code，意图识别 + 子句 + wantsVisualize 应补全
const before = ['rag', 'admin', 'visualize'] as const
const after = alignAllowedAgentsWithUnderstanding({
  routerAllowed: [...before],
  intentClassify: {
    primaryIntent: 'multi',
    isMulti: true,
    suggestedAgents: ['rag', 'code', 'visualize', 'admin'],
    isDbAnchored: false,
    needsAdmin: true,
    needsWeb: false,
    explicitWantsReport: false,
    explicitWantsVisualize: true,
    planShortcut: 'none',
    confidence: 0.82,
    rationale: '复合任务'
  },
  clauses: [
    { id: 'c1', text: '查知识库月度财务', agents: ['rag'], layer: 'data' },
    { id: 'c2', text: '画对比图', agents: ['visualize', 'code'], layer: 'output' },
    { id: 'c3', text: '明天10点日程', agents: ['admin'], layer: 'action' }
  ],
  constraints: {
    timeHints: ['明天10点'],
    subjectHints: [],
    fieldHints: [],
    wantsVisualize: true,
    wantsReport: false
  }
})
assert(after.includes('code'), `must inject code: ${after.join('→')}`)
assert(after.includes('rag') && after.includes('admin') && after.includes('visualize'), 'keep original agents')
const delta = describeAllowedAgentDelta([...before], after)
assert(delta.includes('code'), `delta should mention code: ${delta}`)

// 蓝图格式化
const blueprint = parsePlanBlueprintForTest({
  rationale: 'rag 与 admin 并行；viz 依赖 code',
  parallelNotes: 'c1∥c3',
  confidence: 0.85,
  steps: [
    { agent: 'rag', queryFocus: '检索个人月度财务事实', clauseIds: ['c1'], parallelGroup: 'g1' },
    { agent: 'admin', queryFocus: '创建明天10点日程', clauseIds: ['c3'], parallelGroup: 'g1' },
    { agent: 'code', queryFocus: '汇总财务指标供图表', dependsOnAgents: ['rag'] },
    { agent: 'visualize', queryFocus: '生成对比图', dependsOnAgents: ['code'], clauseIds: ['c2'] }
  ]
})
assert(Boolean(blueprint), 'blueprint parse')
const block = formatPlanBlueprintForPrompt(blueprint)
assert(block.includes('执行蓝图'), 'prompt block header')
assert(block.includes('parallelGroup=g1'), 'parallel hint in block')
assert(block.includes('dependsOnAgents=code'), 'viz depends on code')

console.log('smoke-route-understand-align: OK')
