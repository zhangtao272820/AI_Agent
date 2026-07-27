import {
  finalizeLlmAllowedAgents,
  type ExecutableAgent
} from '../../core/routing/routeFinalize'

/** skill.md 不可读时的极简兜底（正常部署不会走到） */
export const ROUTER_PLAYBOOK_FALLBACK =
  '你是意图理解/路由 Agent（Intents Router）。理解用户意图并输出严格 JSON 路由结果（intent、allowedAgents、needsClarify 等）。'

export function deriveAllowedAgentsFromRoute(intent: string, llmAllowed: ExecutableAgent[]): ExecutableAgent[] {
  return finalizeLlmAllowedAgents(intent, llmAllowed, null)
}

export function finalizeAllowedAgents(intent: string, llmAllowed: ExecutableAgent[], forced: string | null): ExecutableAgent[] {
  return finalizeLlmAllowedAgents(intent, llmAllowed, forced)
}
