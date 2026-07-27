/**
 * crawler 步骤前补跑联网检索（专业模式 SERP 增强 / web_search 节点被跳过的兜底）。
 */
import { clausesFromMeta } from '../../graph/core/routing/clauses'
import { decomposeSearchQueries, formatSerpContextForPrompt } from '../search/managerWebSearch'
import { runSearchLoop } from '../search/managerSearchLoop'
import { isManagerWebSearchEnabled } from '../search/webSearchTool'
import { resolveCrawlerSerpBundleFromMeta } from './managerCrawlerTaskPayload'
import { searchMaxSeeds } from '../search/managerSearchConfig'
import { createManagerChatOpenAI } from '../chat/managerChatOpenAI'

export function isCrawlerRequireSerpEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.MANAGER_CRAWLER_REQUIRE_SERP ?? '1').trim() !== '0'
}

export async function ensureCrawlerSerpEnhancement(input: {
  meta: Record<string, unknown>
  taskText: string
  lastUser: string
  llm?: { openaiApiKey?: string; openaiModel?: string; openaiBaseUrl?: string } | null
  sendThinking?: (text: string) => void
}): Promise<Record<string, unknown>> {
  const meta = input.meta
  const bundle = resolveCrawlerSerpBundleFromMeta(meta)
  if (bundle.serpContext || bundle.seedUrls.length > 0) return meta
  if (!isManagerWebSearchEnabled()) return meta

  const allowed = Array.isArray(meta.allowedAgents) ? (meta.allowedAgents as string[]) : []
  const needsWeb =
    meta.needsWebSearch === true ||
    allowed.includes('crawler') ||
    allowed.includes('music') ||
    allowed.includes('video')
  if (!needsWeb) return meta

  const userText = String(input.taskText || input.lastUser || '').trim()
  if (userText.length < 4) return meta

  input.sendThinking?.('联网检索：为 crawler 补跑 SERP（增强种子 URL 与摘要）…')
  const clauses = clausesFromMeta(meta)
  const initialQueries = decomposeSearchQueries(userText, clauses)
  const llm =
    String(input.llm?.openaiApiKey ?? '').trim()
      ? createManagerChatOpenAI({
          apiKey: String(input.llm!.openaiApiKey),
          modelName: String(input.llm?.openaiModel || 'gpt-4o-mini').trim(),
          openaiBaseUrl: input.llm?.openaiBaseUrl,
          temperature: 0,
          skipThinking: true
        })
      : null

  try {
    const loopResult = await runSearchLoop({
      userText,
      clauses,
      initialQueries,
      llm,
      onRound: (_round, msg) => input.sendThinking?.(`联网检索 ${msg}`)
    })
    const searchHits = loopResult?.searchHits ?? []
    const seedUrls = loopResult?.seedUrls ?? []
    const serpContext = formatSerpContextForPrompt(searchHits)
    if (!searchHits.length && !serpContext) {
      input.sendThinking?.(
        isCrawlerRequireSerpEnabled()
          ? '联网检索：未获得 SERP 结果，禁止单独调用爬虫（须澄清或改走 gui）'
          : '联网检索：未获得 SERP 结果，crawler 将开放式发现'
      )
      return {
        ...meta,
        needsWebSearch: true,
        webSearchMode: isCrawlerRequireSerpEnabled() ? ('crawler_serp_required_miss' as const) : ('crawler_inline_miss' as const),
        crawlerSerpBlocked: isCrawlerRequireSerpEnabled()
      }
    }
    input.sendThinking?.(
      `联网检索：为 crawler 获得 ${searchHits.length} 条命中，种子 ${seedUrls.length} 个`
    )
    return {
      ...meta,
      needsWebSearch: true,
      webSearchMode: 'crawler_inline' as const,
      searchHits,
      seedUrls,
      serpContext,
      searchRounds: loopResult?.searchRounds ?? 1,
      searchQueries: initialQueries,
      ...(loopResult?.searchError ? { searchError: loopResult.searchError } : {})
    }
  } catch (e: unknown) {
    const err = String((e as Error)?.message || e || 'search failed')
    input.sendThinking?.(`联网检索失败：${err}（crawler 将开放式发现）`)
    return { ...meta, needsWebSearch: true, searchError: err, webSearchMode: 'crawler_inline_error' as const }
  }
}

export function formatSerpContextFromPayload(hits: Array<{ title?: string; url?: string; snippet?: string }>): string {
  return hits
    .slice(0, searchMaxSeeds())
    .map((h, i) => `${i + 1}. ${String(h.title || h.url || '').trim()} — ${String(h.snippet || '').trim()}`)
    .filter(Boolean)
    .join('\n')
}
