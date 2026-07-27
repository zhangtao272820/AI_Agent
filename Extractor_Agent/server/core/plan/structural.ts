/**
 * 结构性任务推断：已知榜单/站点补丁优先于 LLM（成熟爬虫 Agent：Plan 层确定性 > LLM）。
 * 仅覆盖 patches/sites 已注册站点，避免泛化关键词误判。
 * 中文规范 SSOT：skills/structured_task_plan/skill.md § StructuralPrinciples
 */
import type { StructuredTaskPlan } from '../../services/crawlerAgentTaskPlanning'
import { parseChineseNumber } from '../../services/crawlerAgentTaskUtils'

export type StructuralTaskInfer = Pick<
  StructuredTaskPlan,
  'targetSite' | 'contentType' | 'limit' | 'fields' | 'openWebSearch' | 'confidence'
>

type SiteRule = {
  site: StructuredTaskPlan['targetSite']
  /** 命中任一词且未命中 exclude 则认定站点 */
  keywords: RegExp
  exclude?: RegExp
  contentType: StructuredTaskPlan['contentType']
  hostPattern: RegExp
}

const SITE_RULES: SiteRule[] = [
  {
    site: 'zhihu',
    keywords: /知乎|zhihu/i,
    exclude: /微博|weibo|豆瓣|bilibili|哔哩|头条|douyin|抖音|京东/i,
    contentType: 'ranking',
    hostPattern: /zhihu\.com/i,
  },
  {
    site: 'weibo',
    keywords: /微博|weibo|新浪微博/i,
    exclude: /知乎|zhihu|豆瓣|bilibili|哔哩/i,
    contentType: 'ranking',
    hostPattern: /weibo\.com/i,
  },
  {
    site: 'douban',
    keywords: /豆瓣|douban/i,
    contentType: 'ranking',
    hostPattern: /douban\.com/i,
  },
  {
    site: 'bilibili',
    keywords: /bilibili|哔哩|B站|b站/i,
    contentType: 'ranking',
    hostPattern: /bilibili\.com/i,
  },
  {
    site: 'toutiao',
    keywords: /头条|toutiao/i,
    exclude: /知乎|微博/i,
    contentType: 'ranking',
    hostPattern: /toutiao\.com/i,
  },
  {
    site: 'douyin',
    keywords: /抖音|douyin/i,
    contentType: 'ranking',
    hostPattern: /douyin\.com/i,
  },
  {
    site: 'jd',
    keywords: /京东|jd\.com/i,
    contentType: 'products',
    hostPattern: /jd\.com/i,
  },
]

const RANKING_HINT = /热榜|热搜|排行榜|榜单|top\s*\d+|前\s*[\d一二三四五六七八九十两百]+/i

/** 从任务文本解析数量（含「前三」「前十」等中文数字） */
export function parseTaskLimitStructural(task: string): number | null {
  const t = String(task ?? '').trim()
  if (!t) return null

  const top = t.match(/\btop\s*(\d+)\b/i)
  if (top) {
    const n = Number(top[1])
    if (Number.isFinite(n) && n > 0) return Math.min(250, Math.floor(n))
  }

  const cnFront = t.match(/前\s*([一二三四五六七八九十两百\d]+)\s*(?:条|名|个|部|款)?/i)
  if (cnFront) {
    const raw = cnFront[1]
    const n = /^\d+$/.test(raw) ? Number.parseInt(raw, 10) : parseChineseNumber(raw)
    if (Number.isFinite(n) && n > 0) return Math.min(250, Math.floor(n))
  }

  const give = t.match(/给(?:我|出)?\s*([一二三四五六七八九十两\d]+)\s*(?:条|名|个)?/i)
  if (give) {
    const raw = give[1]
    const n = /^\d+$/.test(raw) ? Number.parseInt(raw, 10) : parseChineseNumber(raw)
    if (Number.isFinite(n) && n > 0) return Math.min(250, Math.floor(n))
  }

  return null
}

function hostFromTask(task: string): string {
  const m = String(task ?? '').match(/https?:\/\/[^\s]+/i)
  if (!m) return ''
  try {
    return new URL(m[0]).hostname.toLowerCase()
  } catch {
    return ''
  }
}

function matchSiteRule(task: string): SiteRule | null {
  const host = hostFromTask(task)
  if (host) {
    for (const rule of SITE_RULES) {
      if (rule.hostPattern.test(host)) return rule
    }
  }
  for (const rule of SITE_RULES) {
    if (!rule.keywords.test(task)) continue
    if (rule.exclude?.test(task)) continue
    return rule
  }
  return null
}

export function inferStructuralTaskPlan(task: string): StructuralTaskInfer {
  const t = String(task ?? '').trim()
  const limit = parseTaskLimitStructural(t)
  const matched = matchSiteRule(t)
  const hasRankingHint = RANKING_HINT.test(t)

  if (matched) {
    const fields =
      matched.site === 'douban'
        ? ['rank', 'title', 'rating', 'url']
        : ['title', 'url', 'rank']
    return {
      targetSite: matched.site,
      contentType: matched.contentType,
      limit,
      fields,
      openWebSearch: false,
      confidence: 0.88,
    }
  }

  if (limit != null && hasRankingHint) {
    return {
      targetSite: 'generic',
      contentType: 'ranking',
      limit,
      fields: ['title', 'url'],
      openWebSearch: false,
      confidence: 0.5,
    }
  }

  return {
    targetSite: 'generic',
    contentType: 'generic',
    limit,
    fields: ['title', 'url'],
    openWebSearch: false,
    confidence: limit != null ? 0.55 : 0.35,
  }
}

/** 种子 URL 是否与结构化站点一致（防止 LLM 计划跑错站） */
export function seedUrlMatchesTargetSite(seedUrl: string, targetSite: StructuredTaskPlan['targetSite']): boolean {
  if (!targetSite || targetSite === 'generic') return true
  const rule = SITE_RULES.find((r) => r.site === targetSite)
  if (!rule) return true
  try {
    const host = new URL(String(seedUrl ?? '').trim()).hostname.toLowerCase()
    if (targetSite === 'zhihu' && /zhihu\.com\/api\//i.test(String(seedUrl))) return true
    return rule.hostPattern.test(host)
  } catch {
    return false
  }
}

export function mergeStructuralIntoTaskPlan(
  base: StructuredTaskPlan,
  structural: StructuralTaskInfer,
): StructuredTaskPlan {
  const siteLocked = structural.targetSite !== 'generic' && structural.confidence >= 0.72
  const limit =
    structural.limit != null && structural.limit > 0
      ? structural.limit
      : base.limit
  return {
    ...base,
    targetSite: siteLocked ? structural.targetSite : base.targetSite,
    contentType: siteLocked ? structural.contentType : base.contentType !== 'generic' ? base.contentType : structural.contentType,
    limit,
    fields: siteLocked ? structural.fields : base.fields,
    openWebSearch: siteLocked ? false : base.openWebSearch,
    confidence: Math.max(base.confidence, structural.confidence),
  }
}

/** 榜单/API 快路径站点：Verifier 应先 browser 再 cloud（升级文档通道顺序） */
export function isRankingApiFastPathSite(targetSite: StructuredTaskPlan['targetSite']): boolean {
  return ['zhihu', 'bilibili', 'toutiao', 'qqmusic', 'kugou'].includes(String(targetSite ?? ''))
}

/** 云抓取质量重试：仅 JD/高压站或 HTTP 被拦后（MCP 不得成为主路径） */
export function shouldCloudScrapeQualityRetry(input: {
  targetSite: StructuredTaskPlan['targetSite']
  contentType: StructuredTaskPlan['contentType']
  httpBlocked?: boolean
  browserAlreadyTried?: boolean
  preferMcp?: boolean
  preferChannel?: 'http' | 'browser' | 'mcp'
  builtinHandler?: string | null
}): boolean {
  if (input.preferMcp) return true
  if (input.httpBlocked) return true
  // HTTP 优先的内置榜单：抽取失败应修解析，而不是整图重跑云抓取拖长日志
  if (
    input.preferChannel === 'http' &&
    String(input.builtinHandler ?? '').trim() &&
    !input.httpBlocked
  ) {
    return false
  }
  if (input.targetSite === 'jd') return true
  if (input.contentType === 'ranking' && isRankingApiFastPathSite(input.targetSite)) {
    return Boolean(input.browserAlreadyTried)
  }
  if (input.contentType === 'ranking' && input.targetSite !== 'generic') {
    return Boolean(input.browserAlreadyTried)
  }
  return true
}

export function scoreQualityRun(input: {
  fieldCoverage: number
  dupRate: number
  itemCount: number
  requestedLimit: number | null
  minItems: number
}): number {
  const limit = input.requestedLimit && input.requestedLimit > 0 ? input.requestedLimit : input.minItems
  const count = input.itemCount
  let score = input.fieldCoverage - input.dupRate
  if (count >= input.minItems) score += 0.35
  else score += Math.min(0.34, count * 0.08)
  if (limit > 0 && count > limit) score -= Math.min(0.5, (count - limit) * 0.12)
  if (limit > 0 && count > 0 && count <= limit) score += 0.08
  return score
}
