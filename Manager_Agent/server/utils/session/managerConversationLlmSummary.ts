import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { ChatOpenAI } from '@langchain/openai'
import { loadConversationBudgetConfig } from '../../graph/core/runtime/conversationBudget'

export function isLlmConversationSummarizeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env.MANAGER_CONVERSATION_LLM_SUMMARIZE ?? '1').trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'on'
}

export function shouldUseLlmSummary(olderLineCount: number, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!isLlmConversationSummarizeEnabled(env)) return false
  const minLines = Number(env.MANAGER_CONVERSATION_LLM_MIN_LINES ?? 8)
  return olderLineCount >= (Number.isFinite(minLines) ? minLines : 8)
}

export async function summarizeConversationWithLlm(input: {
  olderText: string
  openaiApiKey: string
  openaiBaseUrl: string
  openaiModel: string
}): Promise<string> {
  const cfg = loadConversationBudgetConfig()
  const model = new ChatOpenAI({
    apiKey: input.openaiApiKey,
    configuration: input.openaiBaseUrl ? { baseURL: input.openaiBaseUrl } : undefined,
    model: String(process.env.MANAGER_CONVERSATION_SUMMARY_MODEL || input.openaiModel).trim(),
    temperature: 0.2,
    maxTokens: 512
  })
  const res = await model.invoke([
    new SystemMessage(
      '你是会话摘要器。将较早对话压缩为简洁中文摘要，保留实体、数字、用户目标与结论；不要添加新事实；不超过 600 字。'
    ),
    new HumanMessage(String(input.olderText || '').slice(0, cfg.maxSummaryChars * 2))
  ])
  return String(res.content ?? '').trim()
}

export function buildSummarizeWithLlmFn(input: {
  openaiApiKey?: string
  openaiBaseUrl?: string
  openaiModel?: string
  sessionId?: string
}) {
  if (!input.openaiApiKey || !input.openaiBaseUrl || !input.openaiModel) return undefined
  if (!isLlmConversationSummarizeEnabled()) return undefined

  return async (olderText: string) => {
    const lines = String(olderText || '').split('\n').filter(Boolean)
    if (!shouldUseLlmSummary(lines.length)) return olderText
    const summary = await summarizeConversationWithLlm({
      olderText,
      openaiApiKey: input.openaiApiKey,
      openaiBaseUrl: input.openaiBaseUrl,
      openaiModel: input.openaiModel
    })
    if (summary.length >= 40 && input.sessionId) {
      const { upsertSessionSummary } = await import('./managerSessionSummaryStore')
      await upsertSessionSummary(input.sessionId, summary, 'llm').catch(() => undefined)
    }
    return summary
  }
}
