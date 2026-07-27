import assert from 'node:assert/strict'
import {
  formatChatWebSynthHint,
  isManagerChatWebEnabled,
  shouldForceChatWebDirectSynth
} from '../../../server/utils/chat/managerChatWeb'
import { canCandidateWebDirectSynth } from '../../../server/utils/search/managerWebDirectSynthLlm'
import { applyWebExecutionModeToRoute } from '../../../server/utils/search/managerWebExecutionModeLlm'

assert.equal(isManagerChatWebEnabled(), true)

const chatRoute = applyWebExecutionModeToRoute({
  intent: 'multi',
  allowedAgents: ['db'],
  llmNeedsWebSearch: false,
  mode: {
    mode: 'search_chat',
    primaryAgent: 'crawler',
    needsWebSearch: true,
    serpSummaryEnough: true,
    confidence: 0.9,
    rationale: 'general Q&A'
  }
})
assert.equal(chatRoute.intent, 'crawler')
assert.equal(chatRoute.llmNeedsWebSearch, true)

assert.equal(
  shouldForceChatWebDirectSynth({
    chatWebOnly: true,
    webExecutionMode: { mode: 'search_chat', primaryAgent: 'crawler', needsWebSearch: true, serpSummaryEnough: true, confidence: 0.9, rationale: 'x' }
  }),
  true
)

assert.equal(
  canCandidateWebDirectSynth({
    needsWebSearch: true,
    searchHits: [{ title: 'a', url: 'https://a.test', snippet: 'hello' }],
    chatWebOnly: true
  }),
  true
)

assert.ok(formatChatWebSynthHint({ chatWebOnly: true }).includes('DeepSeek'))

console.log('smoke: manager chat web ok')
