import { routingConversationContext } from '../../core/text'

import type { CreateClarifyNodeDeps } from './types'


export function createClarifyNode(deps: CreateClarifyNodeDeps) {
  const { opts, lastUserText, mergeMeta, appendMemory } = deps
  return async (state: any) => {
    opts.sendEvent({ event: 'phase', data: 'clarify', from: 'manager' })
    const question = lastUserText(state.messages)
    const qs = Array.isArray(state.meta?.clarifyQuestions) ? state.meta.clarifyQuestions : []
    const anchor = String(question || '').trim()
    const meta = mergeMeta(state, {
      needsClarify: true,
      finalConfidence: 0.55,
      uncertainty: 'high',
      clarifyAnchor: anchor,
      clarifyPending: true
    })
    const body = qs.length
      ? `为了确保我给出的是你真正需要的答案，请补充以下信息：\n${qs.map((q, i) => `${i + 1}. ${q}`).join('\n')}`
      : '为了确保我给出的是你真正需要的答案，请补充你期望的时间范围、对象范围或目标输出格式。'
    await appendMemory({ type: 'clarify', user: question, intent: state.intent, routedQuery: state.routedQuery || '', plan: state.plan, clarify: body })
    return { meta, final: body }
  }
}

