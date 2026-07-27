import { ChatOpenAI } from '@langchain/openai'

export type CreateEvaluatorNodeDeps = {
  opts: { sendEvent: (event: { event: string; data?: any; from?: string }) => void }
  mergeMeta: (state: any, patch: Record<string, any>) => Record<string, any>
  llm?: { openaiApiKey?: string; openaiModel?: string; openaiBaseUrl?: string }
}

export function evaluatorModel(deps: CreateEvaluatorNodeDeps): ChatOpenAI | null {
  const key = String(deps.llm?.openaiApiKey ?? process.env.OPENAI_API_KEY ?? '').trim()
  if (!key) return null
  try {
    return new ChatOpenAI({
      apiKey: key,
      modelName: String(deps.llm?.openaiModel || process.env.OPENAI_MODEL || 'gpt-4o-mini').trim(),
      configuration: { baseURL: deps.llm?.openaiBaseUrl || process.env.OPENAI_BASE_URL },
      temperature: 0,
    })
  } catch {
    return null
  }
}

