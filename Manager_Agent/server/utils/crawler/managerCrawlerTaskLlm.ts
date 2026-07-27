import { ChatOpenAI } from '@langchain/openai'
import { z } from 'zod'
import { safeJsonParse } from '../../graph/core/shared'
import type { SiteHint } from './managerCrawlerTaskPayload'

const ManagerCrawlerHintSchema = z.object({
  targetSite: z
    .enum(['douban', 'zhihu', 'weibo', 'bilibili', 'toutiao', 'douyin', 'jd', 'qqmusic', 'kugou', 'generic', 'none'])
    .default('generic'),
  limit: z.number().int().min(1).max(250).nullable().optional(),
  openWebDiscovery: z.boolean().default(false),
  preferredChannel: z.enum(['http', 'browser', 'mcp']).optional(),
  hintFields: z.array(z.string()).max(12).optional(),
  confidence: z.number().min(0).max(1).optional()
})

export type ManagerCrawlerLlmHints = {
  site: SiteHint | null
  limit: number | null
  openWebDiscovery: boolean
}

const SITE_FIELD_MAP: Record<string, SiteHint> = {
  douban: { targetSite: 'douban', fields: ['title', 'rating', 'url', 'rank'], channel: 'http' },
  zhihu: { targetSite: 'zhihu', fields: ['title', 'url', 'excerpt'], channel: 'http' },
  weibo: { targetSite: 'weibo', fields: ['title', 'url', 'hot'], channel: 'http' },
  bilibili: { targetSite: 'bilibili', fields: ['title', 'url', 'play'], channel: 'browser' },
  jd: { targetSite: 'jd', fields: ['title', 'url', 'price'], channel: 'mcp' },
  toutiao: { targetSite: 'toutiao', fields: ['title', 'url'], channel: 'http' },
  douyin: { targetSite: 'douyin', fields: ['title', 'url'], channel: 'browser' }
}

export async function inferManagerCrawlerHintsByLlm(
  task: string,
  model: ChatOpenAI | null,
): Promise<ManagerCrawlerLlmHints | null> {
  if (!model) return null
  const q = String(task ?? '').trim()
  if (!q) return null
  try {
    const res = await model.invoke([
      [
        'system',
        [
          '你是网页抓取任务解析器。根据用户自然语言判断采集意图，只输出 JSON。',
          '不要用关键词表硬匹配；按语义理解站点、数量、是否开放式公网检索。',
          'openWebDiscovery=true：需从互联网找参考资料/对比公开信息/检索说明，且未给出具体站点 URL。',
          'openWebDiscovery=false：已给出 https 链接，或明确点名豆瓣/知乎等固定平台，或站内榜单类任务。',
          'targetSite=none 表示无明确垂直站点；limit 未写明则为 null。',
          'schema: {"targetSite":"douban|zhihu|weibo|bilibili|toutiao|douyin|jd|qqmusic|kugou|generic|none","limit":number|null,"openWebDiscovery":boolean,"preferredChannel":"http|browser|mcp","hintFields":string[],"confidence":number}'
        ].join('\n')
      ],
      ['human', q]
    ])
    const parsed = safeJsonParse(String(res.content ?? '').trim())
    const safe = ManagerCrawlerHintSchema.safeParse(parsed)
    if (!safe.success) return null
    const conf = Number(safe.data.confidence ?? 0)
    if (conf < 0.5) return null

    const siteKey = safe.data.targetSite === 'none' ? '' : safe.data.targetSite
    const baseSite = siteKey && siteKey !== 'generic' ? SITE_FIELD_MAP[siteKey] : null
    const site: SiteHint | null = baseSite
      ? {
          ...baseSite,
          fields: safe.data.hintFields?.length
            ? Array.from(new Set([...baseSite.fields, ...safe.data.hintFields])).slice(0, 12)
            : baseSite.fields,
          channel: safe.data.preferredChannel ?? baseSite.channel
        }
      : null

    const limitRaw = safe.data.limit
    const limit =
      limitRaw != null && Number.isFinite(Number(limitRaw)) && Number(limitRaw) > 0
        ? Math.min(250, Math.floor(Number(limitRaw)))
        : null

    return {
      site,
      limit,
      openWebDiscovery: Boolean(safe.data.openWebDiscovery)
    }
  } catch {
    return null
  }
}
