import { BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages'
import { safeJsonParse } from '../shared'

function humanTexts(messages: BaseMessage[]): string[] {
  const list = Array.isArray(messages) ? messages : []
  return list
    .filter((m) => m instanceof HumanMessage)
    .map((m) => String((m as HumanMessage).content ?? '').trim())
    .filter(Boolean)
}

/**
 * 是否值得在路由前做一次「多轮语义合并」：仅结构条件（轮数、长度比），不依赖承接词正则。
 */
export function shouldRunNlCoalesce(messages: BaseMessage[], lastUser: string): boolean {
  if (String(process.env.MANAGER_DISABLE_NL_COALESCE || '').trim() === '1') return false
  const texts = humanTexts(messages)
  if (texts.length < 2) return false
  const last = String(lastUser || '').trim()
  const prev = texts[texts.length - 2]!
  if (!last || !prev) return false
  if (last.length > 220) return false
  if (last.length <= Math.max(48, Math.floor(prev.length * 0.52))) return true
  if (prev.length >= 80 && last.length / prev.length <= 0.45) return true
  return false
}

/**
 * 用一次极短 LLM 调用把多轮用户输入压成一条「路由启发式用」任务句，避免为每种承接说法写正则。
 * 失败返回 null，由调用方回退到结构化拼接。
 */
export async function coalesceRoutingHeuristicsText(params: {
  llmInvoke: (stage: 'route' | 'plan' | 'synth' | 'critic', state: any, messages: any[]) => Promise<{ text: string; resources: any; meta: any }>
  state: any
  routingContext: string
  lastTurnOnly: string
}): Promise<{ coalesced: string; resources: any; meta: any } | null> {
  const ctx = String(params.routingContext || '').trim()
  const last = String(params.lastTurnOnly || '').trim()
  if (!ctx || !last) return null

  const prompt = [
    new SystemMessage(
      [
        'You compress multi-turn user messages into ONE self-contained task sentence for downstream intent/routing heuristics.',
        'Rules:',
        '- Preserve explicit data-plane wording the user used (e.g. 数据库/表/SQL vs 知识库/文档/制度). Do not invent sources.',
        '- Resolve omissions and pronouns only when the prior turns make them clear; otherwise keep uncertainty in the sentence.',
        '- Output ONLY compact JSON: {"coalesced":"<single sentence or short paragraph, Chinese ok>"}',
        '- Max ~400 Chinese characters in coalesced; no markdown, no code fences.'
      ].join('\n')
    ),
    new HumanMessage(`【多轮拼接】\n${ctx.slice(0, 2200)}\n\n【末轮原话】\n${last.slice(0, 800)}\n\n只输出 JSON：`)
  ]

  try {
    const r = await params.llmInvoke('route', params.state, prompt)
    const raw = String(r.text ?? '').trim()
    const obj = safeJsonParse(raw) as { coalesced?: string } | null
    const c = String(obj?.coalesced ?? '').trim()
    if (c.length < 6 || c.length > 900) return null
    return { coalesced: c, resources: r.resources, meta: r.meta }
  } catch {
    return null
  }
}
