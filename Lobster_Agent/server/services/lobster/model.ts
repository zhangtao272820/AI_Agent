import { ChatOpenAI } from '@langchain/openai'
import { withQwenModelKwargs } from '#agent-shared/qwenModelKwargs'
import type { AgentConfig } from './types'

export function createQwenChatModel(config: AgentConfig, kind: 'planner' | 'decision' | 'vision') {
  const apiKey = String(config?.openaiApiKey ?? '').trim()
  if (!apiKey) return null
  const baseURL = String(config?.openaiBaseUrl ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1').trim()
  const modelName =
    kind === 'planner'
      ? String(config?.lobster?.plannerModel ?? '').trim()
      : kind === 'vision'
        ? String(config?.lobster?.visionModel ?? '').trim()
        : String(config?.lobster?.decisionModel ?? '').trim()
  if (!modelName) return null
  const maxTokens = (() => {
    const v =
      kind === 'planner'
        ? config?.lobster?.plannerMaxTokens
        : kind === 'vision'
          ? config?.lobster?.visionMaxTokens
          : config?.lobster?.decisionMaxTokens
    const n = Number(v)
    if (Number.isFinite(n) && n > 0) return Math.floor(n)
    if (kind === 'planner') return 600
    if (kind === 'vision') return 420
    return 420
  })()
  return new ChatOpenAI(
    withQwenModelKwargs(modelName, {
      apiKey,
      modelName,
      configuration: { baseURL },
      temperature: 0.2,
      maxTokens,
      skipForVision: kind === 'vision',
    }) as ConstructorParameters<typeof ChatOpenAI>[0]
  )
}
