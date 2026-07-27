import { HumanMessage } from '@langchain/core/messages'
import {
  deriveAllowedAgentsFromRoute,
  normalizeLlmAllowedAgents,
  type ExecutableAgent
} from '../../core/routing/routeFinalize'

/** 人工确认/取消（admin）续执行 */
export function tryRouterAdminHumanConfirm(input: {
  state: any
  qTrim: string
  mergeMeta: (state: any, patch: Record<string, any>) => any
  normalizeEntities: (entities: unknown) => unknown
}): Record<string, unknown> | null {
  const { state, qTrim, mergeMeta, normalizeEntities } = input
  const humanDecision = state?.humanDecision
  const isAdminConfirm = humanDecision === 'confirm'
  const isAdminCancel = humanDecision === 'cancel'
  if (!isAdminConfirm && !isAdminCancel) return null

  const humanMessages = Array.isArray(state.messages) ? state.messages.filter((m: any) => m instanceof HumanMessage) : []
  const reversedHumans = [...humanMessages].reverse()
  const resumeQuestion = (() => {
    if (humanDecision) return String(reversedHumans[0]?.content || '').trim() || qTrim
    const prevHuman = reversedHumans.find((m: any) => String(m?.content || '').trim() !== qTrim) || reversedHumans[0]
    return String(prevHuman?.content || '').trim() || qTrim
  })()

  const opRegex = /([a-zA-Z_][a-zA-Z0-9_]*)\s*\[\s*([0-9]+)\s*\]/g
  const funcRegex = /(add_[a-zA-Z0-9_]+)/g
  const extractOps = (text: string) => {
    const s = String(text || '')
    const bracketOps = Array.from(s.matchAll(opRegex))
      .map((m) => {
        const fn = String(m?.[1] || '').trim()
        const idx = String(m?.[2] || '').trim()
        return fn && idx ? `${fn}[${idx}]` : ''
      })
      .filter(Boolean)
    const funcOps = Array.from(s.matchAll(funcRegex)).map((m) => String(m?.[1] || '').trim()).filter(Boolean)
    return Array.from(new Set([...bracketOps, ...funcOps])).slice(0, 10)
  }
  const assistantMessages = Array.isArray(state.messages) ? state.messages.filter((m: any) => !(m instanceof HumanMessage)) : []
  const lastAdminClarifyText =
    [...assistantMessages].reverse().find((m: any) => /等待确认|待确认操作|确认继续|请回复“确认”/i.test(String(m?.content || ''))) || assistantMessages.slice(-1)[0]
  const pendingOps = extractOps(String(lastAdminClarifyText?.content || ''))

  if (isAdminCancel) {
    return {
      intent: 'report',
      allowedAgents: ['report'],
      routedQuery: `用户已取消人工确认。\n\n请停止任何待办/提醒执行，并回复“已取消”。`,
      entities: normalizeEntities(undefined),
      meta: mergeMeta(state, { routeConfidence: 0.95, uncertainty: 'low', lowCostMode: true, needsClarify: false, clarifyQuestions: [] }),
      resources: state.resources
    }
  }

  const pendingOpsText = pendingOps.length ? pendingOps.join('、') : '（未识别到具体操作，按 admin 语义尽量执行）'
  const routedQuery = `${resumeQuestion}\n\n用户已确认：继续执行待确认操作：${pendingOpsText}`

  const prevAllowed = normalizeLlmAllowedAgents(state.allowedAgents)
  const baseAllowed: ExecutableAgent[] = prevAllowed.length ? prevAllowed : ['admin']
  const allowedAgents = deriveAllowedAgentsFromRoute(
    'multi',
    baseAllowed.length >= 2 ? baseAllowed : ['admin', ...baseAllowed]
  )

  return {
    intent: 'multi',
    allowedAgents,
    routedQuery,
    entities: normalizeEntities(undefined),
    meta: mergeMeta(state, { routeConfidence: 0.95, uncertainty: 'low', lowCostMode: true, needsClarify: false, clarifyQuestions: [] }),
    resources: state.resources
  }
}
