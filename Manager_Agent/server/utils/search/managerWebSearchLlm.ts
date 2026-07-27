import { z } from 'zod'
import { safeJsonParse } from '../../graph/core/shared/llmJson'
import type { LlmInvokeFn } from '../../graph/llm/taskConstraintsLlm'
import type { Step } from '#agent-shared/taskPlan'
import {
  extractCurrentUserInput,
  resolveNeedsWebSearch as resolveNeedsWebSearchSync
} from './managerWebSearch'
import { inferCrawlerNeedsSerpByLlm } from '../crawler/managerCrawlerSerpNeedLlm'
import { isManagerWebSearchEnabled } from './webSearchTool'
import { createManagerChatOpenAI } from '../chat/managerChatOpenAI'

const MediaWebSchema = z.object({
  needsReference: z.boolean(),
  confidence: z.number().min(0).max(1).optional()
})

export function isMediaWebSearchLlmEnabled(): boolean {
  return String(process.env.MANAGER_MEDIA_WEB_SEARCH_LLM ?? '1').trim() !== '0'
}

/** @deprecated 请用 inferMediaWebSearchByLlm / resolveNeedsWebSearchAsync */
export function inferMediaWebSearchFromText(_userText: string): boolean {
  return false
}

export async function inferMediaWebSearchByLlm(
  userText: string,
  llm?: { openaiApiKey?: string; openaiModel?: string; openaiBaseUrl?: string } | null,
  llmInvoke?: LlmInvokeFn | null,
  state?: unknown
): Promise<boolean> {
  if (!isMediaWebSearchLlmEnabled()) return false
  const q = extractCurrentUserInput(userText) || String(userText ?? '').trim()
  if (q.length < 4) return false

  if (llmInvoke && state) {
    try {
      const r = await llmInvoke('route', state, [
        [
          'system',
          [
            '你是媒体创作联网需求判断器。用户可能在生成音乐/视频时需要外部风格、场景、流行参考或公开资料。',
            '只输出 JSON；勿用关键词表硬匹配。',
            'needsReference=true：需联网检索参考（曲风、对标作品、实景地标、行业规范、最新趋势等）。',
            'needsReference=false：纯本地创作/已有附件足够/未要求外部参考。',
            'schema: {"needsReference":boolean,"confidence":number}'
          ].join('\n')
        ],
        ['human', q.slice(0, 1200)]
      ], { tier: 'light' })
      const parsed = MediaWebSchema.safeParse(safeJsonParse(String(r.text ?? '').trim()))
      if (parsed.success && Number(parsed.data.confidence ?? 0) >= 0.5) {
        return Boolean(parsed.data.needsReference)
      }
    } catch {
      /* fallback chat model */
    }
  }

  const key = String(llm?.openaiApiKey ?? process.env.OPENAI_API_KEY ?? '').trim()
  if (!key) return false

  try {
    const model = createManagerChatOpenAI({
      apiKey: key,
      modelName: String(llm?.openaiModel || process.env.OPENAI_MODEL || 'gpt-4o-mini').trim(),
      openaiBaseUrl: llm?.openaiBaseUrl || process.env.OPENAI_BASE_URL,
      temperature: 0,
      skipThinking: true
    })
    const res = await model.invoke([
      [
        'system',
        [
          '你是媒体创作联网需求判断器。只输出 JSON。',
          'needsReference=true：需联网检索风格/场景/流行参考等公开资料。',
          'schema: {"needsReference":boolean,"confidence":number}'
        ].join('\n')
      ],
      ['human', q.slice(0, 1200)]
    ])
    const parsed = MediaWebSchema.safeParse(safeJsonParse(String(res.content ?? '').trim()))
    if (!parsed.success || Number(parsed.data.confidence ?? 0) < 0.5) return false
    return Boolean(parsed.data.needsReference)
  } catch {
    return false
  }
}

/** 异步联网判定：路由 LLM 优先，媒体参考走 LLM 启发，无正则兜底 */
export async function resolveNeedsWebSearchAsync(input: {
  llmNeedsWebSearch?: boolean
  intent?: string
  allowedAgents?: Step['agent'][]
  userText?: string
  llmInvoke?: LlmInvokeFn | null
  llm?: { openaiApiKey?: string; openaiModel?: string; openaiBaseUrl?: string } | null
  state?: unknown
}): Promise<{ needsWebSearch: boolean; reason: string }> {
  if (!isManagerWebSearchEnabled()) return { needsWebSearch: false, reason: 'disabled' }

  const sync = resolveNeedsWebSearchSync({
    llmNeedsWebSearch: input.llmNeedsWebSearch,
    intent: input.intent,
    allowedAgents: input.allowedAgents,
    userText: input.userText
  })
  if (sync.needsWebSearch) return sync

  const intent = String(input.intent ?? '').trim()
  const agents = new Set(input.allowedAgents ?? [])
  const mediaInRoute =
    intent === 'music' ||
    intent === 'video' ||
    (intent === 'multi' && (agents.has('music') || agents.has('video')))

  if (mediaInRoute) {
    const needsRef = await inferMediaWebSearchByLlm(
      String(input.userText ?? ''),
      input.llm,
      input.llmInvoke ?? null,
      input.state
    )
    if (needsRef) return { needsWebSearch: true, reason: 'media_reference_llm' }
  }

  const crawlerInRoute =
    intent === 'crawler' || (intent === 'multi' && agents.has('crawler'))
  if (crawlerInRoute && !sync.needsWebSearch) {
    const crawlerSerp = await inferCrawlerNeedsSerpByLlm({
      userText: String(input.userText ?? ''),
      intent,
      allowedAgents: input.allowedAgents,
      llmInvoke: input.llmInvoke ?? null,
      state: input.state
    })
    if (crawlerSerp?.needsSerpSeeds) {
      return { needsWebSearch: true, reason: `crawler_serp_llm:${crawlerSerp.rationale.slice(0, 80)}` }
    }
  }

  return { needsWebSearch: false, reason: 'skip' }
}
