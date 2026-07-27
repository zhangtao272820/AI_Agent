/**
 * 站点 API 快路径：消费 patchRegistry.apiSeedUrl，避免页面 URL 未命中时退回慢速 HTML 解析。
 */
import type { StructuredTaskPlan } from '../../services/crawlerAgentTaskPlanning'
import { getCapabilityProfile, resolvePatchForTask } from '../../services/capabilityRegistry'
import {
  isBilibiliRankingPageUrl,
  isToutiaoRankingPageUrl,
} from '../../services/crawlerAgentTaskUtils'
import {
  extractBilibiliRankItems,
  extractToutiaoHotFromJson,
  fetchBilibiliRankingAll,
  fetchToutiaoHot,
  isZhihuHotTaskUrl,
  resolveZhihuHotItems,
} from './rankingSources'

type FastPathInput = {
  url: string
  taskPlan?: StructuredTaskPlan
  userAgent?: string
  signal: AbortSignal
  maxItems: number
  session?: unknown
  emitLog?: (level: string, msg: string) => void
  fetchPage?: (pageUrl: string, useBrowser: boolean) => Promise<{ html: string; networkJson?: unknown[] }>
}

export async function tryRankingApiFastPath(input: FastPathInput): Promise<Record<string, unknown>[] | null> {
  const url = String(input.url ?? '').trim()
  if (!url) return null
  const remain = Math.max(1, input.maxItems)
  const prof = input.taskPlan
    ? getCapabilityProfile(input.taskPlan.targetSite as any, input.taskPlan.contentType as any)
    : null
  const patch = resolvePatchForTask(input.taskPlan?.targetSite, input.taskPlan?.contentType, url)
  const apiSeed = String(prof?.apiSeedUrl ?? patch?.apiSeedUrl ?? '').trim()

  if (
    apiSeed.includes('bilibili.com') ||
    isBilibiliRankingPageUrl(url) ||
    (input.taskPlan?.targetSite === 'bilibili' && input.taskPlan?.contentType === 'ranking')
  ) {
    try {
      const payload = await fetchBilibiliRankingAll(input.userAgent, input.signal)
      const items = extractBilibiliRankItems(payload, remain) as Record<string, unknown>[]
      if (items.length) {
        input.emitLog?.('info', `Worker：B站榜单 API 快路径命中（${items.length} 条）`)
        return items
      }
    } catch {
      /* fall through */
    }
  }

  if (
    isZhihuHotTaskUrl(url) ||
    (input.taskPlan?.targetSite === 'zhihu' && input.taskPlan?.contentType === 'ranking')
  ) {
    if (!input.fetchPage) return null
    try {
      const items = await resolveZhihuHotItems({
        userAgent: input.userAgent,
        signal: input.signal,
        session: input.session,
        maxItems: remain,
        emitLog: (level, msg) => input.emitLog?.(level, msg),
        fetchPage: input.fetchPage,
      })
      if (items.length) {
        input.emitLog?.('info', `Worker：知乎热榜 API/会话快路径命中（${items.length} 条）`)
        return items as Record<string, unknown>[]
      }
    } catch {
      /* fall through */
    }
  }

  if (
    isToutiaoRankingPageUrl(url) ||
    apiSeed.includes('toutiao.com') ||
    (input.taskPlan?.targetSite === 'toutiao' && input.taskPlan?.contentType === 'ranking')
  ) {
    try {
      const payload = await fetchToutiaoHot(input.userAgent, input.signal)
      const items = extractToutiaoHotFromJson(payload, remain) as Record<string, unknown>[]
      if (items.length) {
        input.emitLog?.('info', `Worker：头条热榜 API 快路径命中（${items.length} 条）`)
        return items
      }
    } catch {
      /* fall through */
    }
  }

  return null
}
