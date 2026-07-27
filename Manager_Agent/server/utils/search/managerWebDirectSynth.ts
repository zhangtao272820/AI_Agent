/**
 * 联网直连汇总：SERP 命中后可选跳过 crawler，由 LLM 启发器 gate（见 managerWebDirectSynthLlm.ts）。
 */

import type { WebSearchHit } from './webSearchTool'
import { formatChatWebSynthHint, shouldForceChatWebDirectSynth } from '../chat/managerChatWeb'
import { formatSerpContextForPrompt } from './managerWebSearch'

export function buildSerpDirectSynthBlock(meta?: Record<string, unknown> | null): string {
  if (!meta || typeof meta !== 'object') return ''
  const hits = (Array.isArray(meta.searchHits) ? meta.searchHits : []) as WebSearchHit[]
  if (!hits.length) return ''

  const tavilyAnswer = String(meta.tavilyAnswer ?? '').trim()
  const ctx = formatSerpContextForPrompt(hits, 2800)
  const citationLines = hits.slice(0, 6).map((h, i) => {
    const title = String(h.title ?? '来源').trim().slice(0, 120)
    const snip = String(h.snippet ?? '').trim().slice(0, 280)
    let host = ''
    try {
      host = new URL(String(h.url ?? '')).hostname
    } catch {
      /* ignore */
    }
    return `[${i + 1}] ${title}${host ? `（${host}）` : ''}：${snip || '（无摘要）'}`
  })

  const chatHint = formatChatWebSynthHint(meta)
  const chatWeb = shouldForceChatWebDirectSynth(meta)
  return [
    chatWeb ? '### 数据来源：联网问答（SERP 摘要直答）' : '### 数据来源：联网检索（公开摘要）',
    tavilyAnswer ? `检索综合摘要：${tavilyAnswer.slice(0, 600)}` : '',
    ctx ? `SERP 上下文：\n${ctx}` : '',
    citationLines.length ? `可引用来源（正文用 [1][2] 角标，勿贴裸 URL）：\n${citationLines.join('\n')}` : '',
    chatHint || '汇总要求：首段直接回答；标注信息时效；数字须来自上方来源；禁止空泛编造。'
  ]
    .filter(Boolean)
    .join('\n')
}
