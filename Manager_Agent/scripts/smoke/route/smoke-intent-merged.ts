/**
 * Stage-4 合并理解 + 多轮 RAG smoke（纯函数）。
 */
import { HumanMessage } from '@langchain/core/messages'
import { parseMergedUnderstandForTest } from '../../../server/graph/llm/intentUnderstandLlm'
import {
  anchorBoostForRecall,
  buildIntentRagQueryText,
  buildSessionIntentAnchor,
  constraintsFromMerged
} from '../../../server/graph/core/memory/multiTurnIntent'
import { mockIntentClassifyForTest } from '../../../server/graph/llm/intentClassifyLlm'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

const merged = parseMergedUnderstandForTest({
  coalesced: '在数据库中查询林婉清足底压力测试记录并汇总',
  timeHints: ['近3个月'],
  subjectHints: ['林婉清'],
  fieldHints: ['足底压力'],
  wantsVisualize: false,
  wantsReport: false,
  primaryIntent: 'db',
  isMulti: false,
  suggestedAgents: ['db'],
  isDbAnchored: true,
  needsAdmin: false,
  needsWeb: false,
  explicitWantsReport: false,
  explicitWantsVisualize: false,
  planShortcut: 'db_only',
  confidence: 0.86,
  rationale: 'test'
})
assert(merged?.classify.primaryIntent === 'db', 'merged classify intent')
assert(merged?.constraints.subjectHints.includes('林婉清'), 'merged constraints')
assert(merged?.coalesced?.includes('林婉清'), 'merged coalesced')

const c = constraintsFromMerged({ timeHints: ['2024'], wantsReport: true })
assert(c.wantsReport && c.timeHints[0] === '2024', 'constraintsFromMerged')

const anchor = buildSessionIntentAnchor(mockIntentClassifyForTest(), '查库任务')
assert(anchor.primaryIntent === 'db' && anchor.coalescedTask === '查库任务', 'session anchor')

const boost = anchorBoostForRecall(
  { primaryIntent: 'db', planShortcut: 'db_only', isDbAnchored: true },
  anchor
)
assert(boost > 0.08, 'anchor boost when aligned')

const msgs = [
  new HumanMessage('在数据库中查询林婉清足底压力测试记录汇总'),
  new HumanMessage('近3个月的呢')
]
const ragQ = buildIntentRagQueryText({ messages: msgs, lastUser: '近3个月的呢', sessionAnchor: anchor })
assert(ragQ.multiTurn, 'short follow-up should be multi-turn')
assert(ragQ.query.length > 10, 'multi-turn rag query non-empty')

console.log('smoke: intent merged stage4 ok')
