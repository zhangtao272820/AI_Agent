import { routingConversationContext } from '../../core/text'
import { resolveSecurityFlags } from '../../llm/securityLlm'
import type { LlmInvokeFn } from '../../llm/taskConstraintsLlm'

import type { CreateSecurityNodeDeps } from './types'


export function createSecurityNode(deps: CreateSecurityNodeDeps) {
  const { opts, lastUserText, mergeMeta, llmInvoke } = deps
  return async (state: any) => {
    opts.sendEvent({ event: 'phase', data: 'security', from: 'manager' })
    const q = routingConversationContext(state.messages as any)
    const assessed = await resolveSecurityFlags(String(q || ''), llmInvoke ?? null, state)
    const { riskLevel, flags } = assessed
    if (riskLevel !== 'low') {
      opts.sendEvent({ event: 'thinking', data: `安全检查：检测到风险信号（${flags.join(', ')}），将启用保守执行策略。`, from: 'manager' })
    }
    return {
      security: { riskLevel, flags, checkedAt: new Date().toISOString() },
      meta: mergeMeta(state, {
        uncertainty: riskLevel === 'high' ? 'high' : state?.meta?.uncertainty ?? 'medium'
      })
    }
  }
}


