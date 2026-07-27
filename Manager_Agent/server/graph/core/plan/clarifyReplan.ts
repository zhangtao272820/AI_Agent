/**
 * P4：模糊问句 clarify 后用户补答 → 合并原问 + 补答，重编排（禁止二次 clarify 循环）
 */

const CLARIFY_MARKERS = ['请补充以下信息', '请补充你期望的时间范围', '为了确保我给出的是你真正需要的答案']

export function looksLikeClarifyAssistantReply(text: string): boolean {
  const s = String(text || '').trim()
  if (!s) return false
  return CLARIFY_MARKERS.some((m) => s.includes(m))
}

export function buildClarifyMergedQuery(anchor: string, reply: string): string {
  const a = String(anchor || '').trim()
  const r = String(reply || '').trim()
  if (!a) return r
  if (!r) return a
  if (a.includes(r) || r.includes(a)) return r.length >= a.length ? r : a
  return `${a}；补充：${r}`
}

export type ClarifyFollowUp = {
  anchor: string
  reply: string
  merged: string
}

/** 从会话消息推断 clarify 补答（上一轮 assistant 为澄清卡） */
export function detectClarifyFollowUp(
  messages: Array<{ role?: string; content?: string }>,
  latestUserText: string
): ClarifyFollowUp | null {
  const rows = Array.isArray(messages) ? messages : []
  const reply = String(latestUserText || '').trim()
  if (reply.length < 2) return null
  let lastAssistant = ''
  let anchorUser = ''
  for (let i = rows.length - 1; i >= 0; i--) {
    const m = rows[i]
    const role = String(m?.role || '')
    const content = String(m?.content || '').trim()
    if (!content) continue
    if (!lastAssistant && role === 'assistant') {
      lastAssistant = content
      continue
    }
    if (lastAssistant && role === 'user' && content !== reply) {
      anchorUser = content
      break
    }
  }
  if (!lastAssistant || !looksLikeClarifyAssistantReply(lastAssistant)) return null
  if (!anchorUser) {
    for (let i = rows.length - 2; i >= 0; i--) {
      if (String(rows[i]?.role) === 'user') {
        const c = String(rows[i]?.content || '').trim()
        if (c && c !== reply) {
          anchorUser = c
          break
        }
      }
    }
  }
  if (!anchorUser) return null
  return {
    anchor: anchorUser,
    reply,
    merged: buildClarifyMergedQuery(anchorUser, reply)
  }
}

export function clarifyReplanMetaPatch(followUp: ClarifyFollowUp): Record<string, unknown> {
  return {
    clarifyReplan: true,
    clarifyAnchor: followUp.anchor,
    clarifyReply: followUp.reply,
    clarifyMergedQuery: followUp.merged,
    needsClarify: false,
    clarifyQuestions: [],
    clarifySuppressSecondLoop: true
  }
}
