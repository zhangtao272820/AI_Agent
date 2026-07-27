/**
 * Stage-3 意图 RAG 召回 smoke（纯函数，不调 embedding API）。
 */
import { MANAGER_INTENT_PLAYBOOK } from '../../../server/graph/core/memory/intentPlaybook'
import {
  alignIntentClassifyWithRecall,
  intentRecallHitToClassify,
  shouldUseIntentRagFastPath
} from '../../../server/graph/core/rag/intentRagRecallCore'
import { mockIntentClassifyForTest } from '../../../server/graph/llm/intentClassifyLlm'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

process.env.MANAGER_VECTOR_MEMORY = '0'

assert(MANAGER_INTENT_PLAYBOOK.length >= 10, 'intent playbook should have >=10 entries')

const dbHit = {
  id: 'db_lookup_person',
  score: 0.82,
  source: 'playbook' as const,
  matchedText: '在数据库里查某人的检测记录',
  primaryIntent: 'db' as const,
  isMulti: false,
  suggestedAgents: ['db'] as const,
  isDbAnchored: true,
  needsAdmin: false,
  needsWeb: false,
  explicitWantsReport: false,
  explicitWantsVisualize: false,
  planShortcut: 'db_only' as const,
  explanation: 'test'
}

assert(shouldUseIntentRagFastPath(dbHit), 'high score playbook should fast-path')
assert(!shouldUseIntentRagFastPath({ ...dbHit, score: 0.5 }), 'low score should not fast-path')

const financeExpHit = {
  ...dbHit,
  id: 'exp:finance',
  source: 'experience' as const,
  primaryIntent: 'multi' as const,
  planShortcut: 'none' as const,
  suggestedAgents: ['rag', 'clean', 'code', 'report'] as ('rag' | 'clean' | 'code' | 'report')[],
  score: 0.92
}
assert(
  !shouldUseIntentRagFastPath(financeExpHit, '在知识库中查询我的月度财务状况'),
  'experience heavy path blocked for simple kb finance query'
)

const fast = intentRecallHitToClassify(dbHit)
assert(fast.primaryIntent === 'db' && fast.planShortcut === 'db_only', 'fast path maps to classify result')
assert(fast.confidence >= 0.78, 'fast path confidence should be high')

const llm = mockIntentClassifyForTest({ confidence: 0.7, rationale: 'llm' })
const aligned = alignIntentClassifyWithRecall(llm, {
  items: [dbHit],
  text: '',
  count: 1,
  vectorRecall: false,
  topHit: dbHit,
  scenarioKey: 'x'
})
assert(aligned.confidence > llm.confidence, 'align should boost when rag agrees')

console.log('smoke: intent rag recall ok')
