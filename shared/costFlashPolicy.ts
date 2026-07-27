/**
 * Cost-Flash M5：Intent RAG prompt 注入 token 预算（§13.5.2）。
 */
export const INTENT_RAG_PROMPT_TOP_K = 2
export const INTENT_RAG_HINT_MAX_CHARS = 120

export function clipIntentRagHint(text: string, max = INTENT_RAG_HINT_MAX_CHARS): string {
  const s = String(text ?? '').trim()
  if (s.length <= max) return s
  return `${s.slice(0, Math.max(1, max - 1))}…`
}

export function intentRagPromptTopK(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.MANAGER_INTENT_RAG_TOP_K ?? INTENT_RAG_PROMPT_TOP_K)
  if (!Number.isFinite(n) || n < 1) return INTENT_RAG_PROMPT_TOP_K
  return Math.min(8, Math.floor(n))
}
