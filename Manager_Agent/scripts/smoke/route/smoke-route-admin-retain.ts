/**
 * 路由 admin 保留：路由 LLM 显式输出 admin 时，intentClassify.needsAdmin=false 不得剔除。
 */
import {
  stripAdminIfNotInCurrentTurn,
  supplementAllowedFromClauses,
  normalizeLlmAllowedAgents
} from '../../../server/graph/core/routing/routeFinalize'
import { mockIntentClassifyForTest } from '../../../server/graph/llm/intentClassifyLlm'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

const comboQ =
  '在知识库中查询我的月度个人财务情况，提炼要点并生成对比图，并帮我创建明天上午10点的会议日程，标题项目周会，并设置会议提醒'

const routerOut = normalizeLlmAllowedAgents(['rag', 'visualize', 'admin'])
const classifyNoAdmin = mockIntentClassifyForTest({
  primaryIntent: 'rag',
  isMulti: true,
  needsAdmin: false,
  planShortcut: 'none',
  suggestedAgents: ['rag', 'visualize']
})

const kept = stripAdminIfNotInCurrentTurn(routerOut, comboQ, classifyNoAdmin, {
  routerLlmAllowed: routerOut
})
assert(kept.includes('admin'), `router explicit admin must survive strip: ${kept.join('→')}`)

const stripped = stripAdminIfNotInCurrentTurn(['rag', 'admin'], comboQ, classifyNoAdmin, {
  routerLlmAllowed: ['rag']
})
assert(!stripped.includes('admin'), 'probe-injected admin without router consent should strip')

const fromClauses = supplementAllowedFromClauses(['rag', 'visualize'], ['admin'])
assert(fromClauses.includes('admin'), 'decompose clause admin should supplement cap')

console.log('smoke: route admin retain ok')
