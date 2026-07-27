/**
 * 网页交互路由启发（Router 层）：委托统一执行模式 LLM，并做 intent/allowed 同步。
 */

import type { LlmInvokeFn } from './taskConstraintsLlm'
import type { ExecutableAgent } from '../core/routing/routeFinalize'
import {
  applyWebExecutionModeToRoute,
  isWebExecutionModeLlmEnabled,
  resolveWebExecutionModeByLlm,
  type WebExecutionModeDecision
} from '../../utils/search/managerWebExecutionModeLlm'

export { formatWebExecutionModeForPrompt, webExecutionModeFromMeta, type WebExecutionModeDecision } from '../../utils/search/managerWebExecutionModeLlm'

export function isWebInteractiveRouteLlmEnabled(): boolean {
  return isWebExecutionModeLlmEnabled()
}

/** @deprecated 请用 resolveWebExecutionModeByLlm；保留兼容包装 */
export async function inferNeedsGuiBrowserByLlm(input: {
  userText: string
  allowedAgents: ExecutableAgent[]
  llmInvoke?: LlmInvokeFn | null
  state?: unknown
  llm?: { openaiApiKey?: string; openaiModel?: string; openaiBaseUrl?: string } | null
}): Promise<boolean> {
  const mode = await resolveWebExecutionModeByLlm({
    userText: input.userText,
    allowedAgents: input.allowedAgents,
    llmInvoke: input.llmInvoke,
    state: input.state,
    llm: input.llm
  })
  return mode?.mode === 'gui'
}

/** Router：LLM 判定网页执行模式并补全/修正 allowedAgents */
export async function supplementAllowedFromWebStructuralAsync(
  allowed: ExecutableAgent[],
  userText: string,
  llm?: {
    llmInvoke?: LlmInvokeFn | null
    state?: unknown
    routeIntent?: string
    llmNeedsWebSearch?: boolean
    toolHealth?: { agents?: Array<{ agent: string; status: string }> } | null
    openaiApiKey?: string
    openaiModel?: string
    openaiBaseUrl?: string
  }
): Promise<{ allowedAgents: ExecutableAgent[]; webExecutionMode: WebExecutionModeDecision | null }> {
  if (!userText.trim()) return { allowedAgents: allowed, webExecutionMode: null }

  const mode = await resolveWebExecutionModeByLlm({
    userText,
    allowedAgents: allowed,
    routeIntent: llm?.routeIntent,
    llmNeedsWebSearch: llm?.llmNeedsWebSearch,
    toolHealth: llm?.toolHealth,
    llmInvoke: llm?.llmInvoke,
    state: llm?.state,
    llm
  })
  if (!mode || mode.mode === 'not_web') return { allowedAgents: allowed, webExecutionMode: mode }

  const applied = applyWebExecutionModeToRoute({
    intent: String(llm?.routeIntent ?? 'multi'),
    allowedAgents: allowed,
    llmNeedsWebSearch: llm?.llmNeedsWebSearch,
    mode
  })
  return { allowedAgents: applied.allowedAgents, webExecutionMode: applied.webExecutionMode }
}

/** GUI / 网页模式补全后同步 intent / 联网开关 */
export function applyGuiRouteOverrides(input: {
  intent: string
  allowedAgents: ExecutableAgent[]
  llmNeedsWebSearch?: boolean
  webExecutionMode?: WebExecutionModeDecision | null
  compositeDataWebRoute?: boolean
}): {
  intent: string
  allowedAgents: ExecutableAgent[]
  llmNeedsWebSearch: boolean
} {
  if (input.compositeDataWebRoute) {
    const allowed = input.allowedAgents.filter((a) => a !== 'gui')
    const intent =
      allowed.length > 1 ? 'multi' : String(input.intent || 'multi') === 'gui' ? 'multi' : String(input.intent || 'multi')
    return {
      intent,
      allowedAgents: allowed,
      llmNeedsWebSearch: input.llmNeedsWebSearch === true
    }
  }

  if (input.webExecutionMode) {
    const applied = applyWebExecutionModeToRoute({
      intent: input.intent,
      allowedAgents: input.allowedAgents,
      llmNeedsWebSearch: input.llmNeedsWebSearch,
      mode: input.webExecutionMode,
      compositeDataWebRoute: input.compositeDataWebRoute
    })
    return {
      intent: applied.intent,
      allowedAgents: applied.allowedAgents,
      llmNeedsWebSearch: applied.llmNeedsWebSearch
    }
  }

  let intent = String(input.intent ?? '').trim()
  let allowed = [...input.allowedAgents]
  let llmNeedsWebSearch = input.llmNeedsWebSearch === true

  if (!allowed.includes('gui')) {
    return { intent, allowedAgents: allowed, llmNeedsWebSearch }
  }

  if (allowed.includes('crawler') && allowed.length === 2 && allowed.includes('gui')) {
    allowed = allowed.filter((a) => a !== 'crawler')
  }

  if (allowed.length === 1 && allowed[0] === 'gui') {
    return { intent: 'gui', allowedAgents: allowed, llmNeedsWebSearch: false }
  }

  if (!allowed.includes('crawler') && (intent === 'crawler' || intent === 'multi')) {
    intent = allowed.length > 1 ? 'multi' : 'gui'
    if (intent === 'gui') llmNeedsWebSearch = false
  }

  return { intent, allowedAgents: allowed, llmNeedsWebSearch }
}
