import assert from 'node:assert/strict'
import { HumanMessage } from '@langchain/core/messages'
import { resolveTurnRoutingScope, shouldDirectChitchatSynth } from '../../../server/graph/core/routing/turnScope'

const chitchatScope = resolveTurnRoutingScope({
  messages: [new HumanMessage('你好')],
  lastUser: '你好',
  turnScopeLlm: {
    mode: 'chitchat',
    directChitchatSynth: true,
    confidence: 0.92,
    rationale: '纯寒暄'
  }
})
assert.equal(chitchatScope.directChitchatSynth, true)
assert.equal(chitchatScope.mode, 'chitchat')

const msgs = [
  new HumanMessage('查知识库探视制度并写报告'),
  new HumanMessage('有哪些免费的搜索 API')
]
const shiftScope = resolveTurnRoutingScope({
  messages: msgs,
  lastUser: '有哪些免费的搜索 API',
  sessionAnchor: {
    primaryIntent: 'rag',
    planShortcut: 'rag_only',
    suggestedAgents: ['rag'],
    isDbAnchored: false,
    isMulti: false,
    updatedAt: new Date().toISOString()
  },
  turnScopeLlm: {
    mode: 'topic_shift',
    directChitchatSynth: false,
    confidence: 0.88,
    rationale: '本轮为公网搜索 API，与上轮知识库报告无关'
  }
})
assert.equal(shiftScope.mode, 'topic_shift')
assert.equal(shiftScope.suppressSessionAnchor, true)
assert.equal(shiftScope.routingContext, '有哪些免费的搜索 API')

const contMsgs = [new HumanMessage('查销售Top5'), new HumanMessage('只要前3名')]
const contScope = resolveTurnRoutingScope({
  messages: contMsgs,
  lastUser: '只要前3名',
  sessionAnchor: {
    primaryIntent: 'db',
    planShortcut: 'db_only',
    suggestedAgents: ['db'],
    isDbAnchored: true,
    isMulti: false,
    updatedAt: new Date().toISOString()
  },
  turnScopeLlm: {
    mode: 'continuation',
    directChitchatSynth: false,
    confidence: 0.86,
    rationale: '筛选条件承接上轮查数'
  }
})
assert.equal(contScope.mode, 'continuation')

assert.equal(
  shouldDirectChitchatSynth({
    meta: { directChitchatSynth: true },
    turnScope: resolveTurnRoutingScope({
      messages: msgs,
      lastUser: '有哪些免费的搜索 API',
      turnScopeLlm: {
        mode: 'continuation',
        directChitchatSynth: false,
        confidence: 0.9,
        rationale: 'wrong'
      }
    })
  }),
  true
)

console.log('smoke-turn-scope-routing ok')
