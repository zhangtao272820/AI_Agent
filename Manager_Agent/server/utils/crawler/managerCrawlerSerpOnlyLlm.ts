import { z } from 'zod'
import type { ChatOpenAI } from '@langchain/openai'
import { safeJsonParse } from '../../graph/core/shared/llmJson'
import type { LlmInvokeFn } from '../../graph/llm/taskConstraintsLlm'
import { createManagerChatOpenAI } from '../chat/managerChatOpenAI'

const SerpOnlySchema = z.object({
  serpOnly: z.boolean(),
  confidence: z.number().min(0).max(1).optional(),
  rationale: z.string().optional()
})

export type SerpOnlyDecision = {
  serpOnly: boolean
  rationale?: string
}

function serpReady(meta?: Record<string, unknown> | null): boolean {
  if (!meta || typeof meta !== 'object') return false
  return (
    Boolean(String(meta.serpContext ?? '').trim()) ||
    (Array.isArray(meta.searchHits) && meta.searchHits.length > 0) ||
    (Array.isArray(meta.seedUrls) && meta.seedUrls.length > 0)
  )
}

/** 结构性前置：无 SERP 上下文 / 显式 URL / 路由已选 GUI 时不可走 SERP 快路径（非任务语义正则） */
export function inferSerpOnlyStructural(
  taskText: string,
  meta?: Record<string, unknown> | null
): SerpOnlyDecision | null {
  const q = String(taskText ?? '').trim()
  if (!q || !serpReady(meta)) return { serpOnly: false, rationale: 'no_serp_context' }
  if (q.includes('http://') || q.includes('https://')) return { serpOnly: false, rationale: 'explicit_url' }

  const allowed = Array.isArray(meta?.allowedAgents) ? (meta!.allowedAgents as string[]) : []
  if (allowed.includes('gui') || String(meta?.intent ?? '') === 'gui') {
    return { serpOnly: false, rationale: 'gui_route' }
  }

  const webMode = meta?.webExecutionMode as { mode?: string; serpSummaryEnough?: boolean } | undefined
  if (webMode?.mode === 'gui' || webMode?.mode === 'search_then_crawl' || webMode?.mode === 'crawl_direct') {
    return { serpOnly: false, rationale: `web_mode_${webMode.mode}` }
  }
  if (webMode?.mode === 'search_serp_only' || webMode?.serpSummaryEnough === true) {
    return { serpOnly: true, rationale: 'web_mode_serp_only' }
  }
  if (meta?.compositeWebExecution === 'serp_summary') {
    return { serpOnly: true, rationale: 'composite_serp_summary' }
  }

  return null
}

/** LLM 判定是否仅需 SERP 摘要、跳过全量浏览器抓取 */
export async function inferSerpOnlyByLlm(input: {
  taskText: string
  meta?: Record<string, unknown> | null
  llmInvoke: LlmInvokeFn
  state: unknown
}): Promise<SerpOnlyDecision | null> {
  const q = String(input.taskText ?? '').trim()
  if (!q || !serpReady(input.meta)) return null

  try {
    const serpSnippet = String(input.meta?.serpContext ?? '').trim().slice(0, 600)
    const hitCount = Array.isArray(input.meta?.searchHits) ? input.meta!.searchHits!.length : 0
    const r = await input.llmInvoke('plan', input.state, [
      [
        'system',
        [
          '你是爬虫执行策略启发器。判断用户任务是否只需联网检索摘要即可满足，无需全量页面/榜单抓取。',
          '只输出 JSON，禁止 markdown；勿用关键词表硬匹配。',
          '若【路由网页执行模式】已给出 serpSummaryEnough，须对齐。',
          'serpOnly=true：用户要参考范围/标准值/指南摘要/公开资料对照/对比报告/多源汇总等，SERP 摘要足够；已有 3 条以上相关命中时优先 true。',
          'serpOnly=false：需全文抓取、完整页面、榜单/排行榜、浏览器交互抽取；或已给具体 URL 且用户明确要求打开该页正文。',
          'schema: {"serpOnly":boolean,"confidence":number,"rationale":string}'
        ].join('\n')
      ],
      [
        'human',
        [
          `用户任务：${q.slice(0, 800)}`,
          hitCount ? `SERP 命中数：${hitCount}` : '',
          serpSnippet ? `SERP 摘要片段：\n${serpSnippet}` : '',
          input.meta?.webExecutionMode
            ? `【路由网页执行模式】${JSON.stringify(input.meta.webExecutionMode)}`
            : ''
        ]
          .filter(Boolean)
          .join('\n\n')
      ]
    ], { tier: 'light' })
    const parsed = SerpOnlySchema.safeParse(safeJsonParse(String(r.text ?? '').trim()))
    if (!parsed.success || Number(parsed.data.confidence ?? 0) < 0.5) return null
    return {
      serpOnly: Boolean(parsed.data.serpOnly),
      rationale: parsed.data.rationale
    }
  } catch {
    return null
  }
}

export function isSerpOnlyLlmEnabled(): boolean {
  return String(process.env.MANAGER_CRAWLER_SERP_ONLY_LLM ?? '1').trim() !== '0'
}

/** 直连 ChatOpenAI（exec 节点无 llmInvoke 时使用） */
export async function inferSerpOnlyByChatModel(
  taskText: string,
  meta: Record<string, unknown> | null | undefined,
  model: ChatOpenAI | null
): Promise<SerpOnlyDecision | null> {
  if (!model) return null
  const q = String(taskText ?? '').trim()
  if (!q || !serpReady(meta)) return null
  try {
    const serpSnippet = String(meta?.serpContext ?? '').trim().slice(0, 600)
    const hitCount = Array.isArray(meta?.searchHits) ? meta!.searchHits!.length : 0
    const res = await model.invoke([
      [
        'system',
        [
          '你是爬虫执行策略启发器。判断用户任务是否只需联网检索摘要即可满足，无需全量页面/榜单抓取。',
          '只输出 JSON，禁止 markdown；勿用关键词表硬匹配。',
          '若【路由网页执行模式】已给出 serpSummaryEnough，须对齐。',
          'serpOnly=true：用户要参考范围/标准值/指南摘要/公开资料对照/对比报告/多源汇总等，SERP 摘要足够；已有 3 条以上相关命中时优先 true。',
          'serpOnly=false：需全文抓取、完整页面、榜单/排行榜、浏览器交互抽取；或已给具体 URL 且用户明确要求打开该页正文。',
          'schema: {"serpOnly":boolean,"confidence":number,"rationale":string}'
        ].join('\n')
      ],
      [
        'human',
        [
          `用户任务：${q.slice(0, 800)}`,
          hitCount ? `SERP 命中数：${hitCount}` : '',
          serpSnippet ? `SERP 摘要片段：\n${serpSnippet}` : '',
          meta?.webExecutionMode ? `【路由网页执行模式】${JSON.stringify(meta.webExecutionMode)}` : ''
        ]
          .filter(Boolean)
          .join('\n\n')
      ]
    ])
    const parsed = SerpOnlySchema.safeParse(safeJsonParse(String(res.content ?? '').trim()))
    if (!parsed.success || Number(parsed.data.confidence ?? 0) < 0.5) return null
    return { serpOnly: Boolean(parsed.data.serpOnly), rationale: parsed.data.rationale }
  } catch {
    return null
  }
}

export async function resolveSerpOnlyForCrawler(
  taskText: string,
  meta: Record<string, unknown> | null | undefined,
  llm?: { openaiApiKey?: string; openaiModel?: string; openaiBaseUrl?: string } | null,
  llmInvoke?: LlmInvokeFn | null,
  state?: unknown
): Promise<boolean> {
  if (String(process.env.MANAGER_CRAWLER_SERP_ONLY ?? '1').trim() === '0') return false

  const allowed = Array.isArray(meta?.allowedAgents) ? (meta!.allowedAgents as string[]) : []
  if (allowed.includes('gui')) return false

  const structural = inferSerpOnlyStructural(taskText, meta)
  if (structural && !structural.serpOnly) return false
  if (!serpReady(meta)) return false

  if (isSerpOnlyLlmEnabled()) {
    if (llmInvoke && state) {
      const llmDecision = await inferSerpOnlyByLlm({ taskText, meta, llmInvoke, state })
      if (llmDecision) return llmDecision.serpOnly
    }
    const key = String(llm?.openaiApiKey ?? '').trim()
    if (key) {
      try {
        const model = createManagerChatOpenAI({
          apiKey: String(llm!.openaiApiKey),
          modelName: String(llm?.openaiModel || 'gpt-4o-mini').trim(),
          openaiBaseUrl: llm?.openaiBaseUrl,
          temperature: 0,
          skipThinking: true
        })
        const chatDecision = await inferSerpOnlyByChatModel(taskText, meta, model)
        if (chatDecision) return chatDecision.serpOnly
      } catch {
        /* fallback below */
      }
    }
  }

  return structural?.serpOnly ?? false
}

/** 先结构性推断，必要时 LLM；MANAGER_CRAWLER_SERP_ONLY=0 时整体关闭 */
export async function resolveShouldUseSerpOnlyCrawler(input: {
  taskText: string
  meta?: Record<string, unknown> | null
  llmInvoke?: LlmInvokeFn | null
  state?: unknown
  llm?: { openaiApiKey?: string; openaiModel?: string; openaiBaseUrl?: string } | null
}): Promise<boolean> {
  return resolveSerpOnlyForCrawler(input.taskText, input.meta, input.llm, input.llmInvoke, input.state)
}
