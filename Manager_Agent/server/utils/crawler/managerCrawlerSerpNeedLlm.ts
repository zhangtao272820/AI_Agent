import { z } from 'zod'
import { safeJsonParse } from '../../graph/core/shared/llmJson'
import type { LlmInvokeFn } from '../../graph/llm/taskConstraintsLlm'
import { extractCurrentUserInput } from '../search/managerWebSearch'

const CrawlerSerpNeedSchema = z.object({
  needsSerpSeeds: z.boolean(),
  confidence: z.number().min(0).max(1),
  rationale: z.string().max(320).default('')
})

export function isCrawlerSerpNeedLlmEnabled(): boolean {
  return String(process.env.MANAGER_CRAWLER_SERP_NEED_LLM ?? '1').trim() !== '0'
}

/** 路由未显式 needsWebSearch 时，LLM 判定 crawler 任务是否应先联网拿种子 */
export async function inferCrawlerNeedsSerpByLlm(input: {
  userText: string
  intent?: string
  allowedAgents?: string[]
  llmInvoke?: LlmInvokeFn | null
  state?: unknown
}): Promise<{ needsSerpSeeds: boolean; rationale: string } | null> {
  if (!isCrawlerSerpNeedLlmEnabled()) return null
  const agents = new Set((input.allowedAgents || []).map((a) => String(a).trim()))
  const intent = String(input.intent ?? '').trim()
  const crawlerInRoute = intent === 'crawler' || (intent === 'multi' && agents.has('crawler'))
  if (!crawlerInRoute) return null

  const q = extractCurrentUserInput(input.userText) || String(input.userText || '').trim()
  if (q.length < 4) return null

  if (!input.llmInvoke || !input.state) return null

  try {
    const r = await input.llmInvoke(
      'route',
      input.state,
      [
        [
          'system',
          [
            '你是爬虫前置联网判定器。判断执行网页抓取前是否必须先做 Manager 联网检索（SERP）以获取 URL 种子与摘要。',
            'needsSerpSeeds=true：开放式公网发现、对比两家/多源公开信息、新闻政策价格、未给出具体 https 链接的检索类任务。',
            'needsSerpSeeds=false：用户已给出明确 URL；或纯知识库/数据库/代码/办公任务（虽 allowed 含 crawler 但本轮不应联网）。',
            '只输出 JSON，无 markdown。'
          ].join('\n')
        ],
        ['human', `【用户任务】\n${q.slice(0, 1200)}\n\nschema: {"needsSerpSeeds":bool,"confidence":0-1,"rationale":"..."}`]
      ],
      { tier: 'light' }
    )
    const parsed = CrawlerSerpNeedSchema.safeParse(safeJsonParse(String(r.text ?? '').trim()))
    if (!parsed.success || Number(parsed.data.confidence) < 0.5) return null
    return {
      needsSerpSeeds: Boolean(parsed.data.needsSerpSeeds),
      rationale: parsed.data.rationale
    }
  } catch {
    return null
  }
}
