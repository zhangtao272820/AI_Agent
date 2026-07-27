import { ChatOpenAI } from '@langchain/openai'
import { withQwenModelKwargs } from '#agent-shared/qwenModelKwargs'
import {
  readAgentLlmJsonMaxTokens,
  readAgentLlmMaxRetries,
  readAgentLlmRequestTimeoutMs,
  readAgentLlmSynthMaxTokens
} from '#agent-shared/agentLlmSpeed'

export function createCodeChatOpenAI(input: {
  apiKey: string
  model: string
  baseURL?: string
  temperature?: number
  maxTokens?: number
  streaming?: boolean
  jsonTask?: boolean
}): ChatOpenAI {
  const model = String(input.model || '').trim()
  const baseURL = String(input.baseURL ?? process.env.OPENAI_BASE_URL ?? '').trim()
  const maxTokens =
    typeof input.maxTokens === 'number'
      ? input.maxTokens
      : input.jsonTask
        ? readAgentLlmJsonMaxTokens()
        : readAgentLlmSynthMaxTokens()
  return new ChatOpenAI(
    withQwenModelKwargs(
      model,
      {
        apiKey: input.apiKey,
        model,
        configuration: baseURL ? { baseURL } : undefined,
        temperature: input.temperature ?? 0.1,
        timeout: readAgentLlmRequestTimeoutMs(),
        maxRetries: readAgentLlmMaxRetries(),
        maxTokens,
        ...(input.streaming ? { streaming: true } : {})
      },
      { enableThinking: false }
    ) as ConstructorParameters<typeof ChatOpenAI>[0]
  )
}
