/** 从 LangChain / OpenAI 兼容响应中提取 token 用量（用于 search 节点记账） */

export function llmTokensFromResponse(res: unknown): number {
  const r = res as Record<string, unknown> | null | undefined
  if (!r || typeof r !== 'object') return 0
  const meta = (r.response_metadata ?? r.usage_metadata) as Record<string, unknown> | undefined
  const usage = (meta?.token_usage ?? meta) as Record<string, unknown> | undefined
  const total = Number(usage?.total_tokens ?? usage?.totalTokens ?? 0)
  if (Number.isFinite(total) && total > 0) return Math.floor(total)
  const text = String(r.content ?? '')
  return text ? Math.ceil(text.length / 3) : 0
}
