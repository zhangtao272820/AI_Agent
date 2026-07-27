import type { ChatMessage } from '../../../utils/agents/types'

const OUTPUT_FOLLOWUP_MAX_CHARS = 4800

/** output_followup：仅上一轮 assistant 回复（结构截取，非正则判意图） */
export function buildOutputFollowupNarrowHistory(
  messages: Array<{ role?: string; content?: string }> | undefined,
  currentUserText: string,
  maxChars = OUTPUT_FOLLOWUP_MAX_CHARS
): ChatMessage[] {
  const cur = String(currentUserText || '').trim()
  const rows = (Array.isArray(messages) ? messages : [])
    .map((m) => ({
      role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
      content: String(m.content ?? '').trim()
    }))
    .filter((m) => m.content)
  if (!rows.length) return []

  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i]!
    if (cur && r.role === 'user' && r.content === cur) continue
    if (r.role === 'assistant') {
      return [{ role: 'assistant', content: r.content.slice(0, maxChars) }]
    }
  }
  const lastAsst = [...rows].reverse().find((r) => r.role === 'assistant')
  return lastAsst ? [{ role: 'assistant', content: lastAsst.content.slice(0, maxChars) }] : []
}
