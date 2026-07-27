export type CrawlerAgentTaskUtilsPlan = {
  target?: string
  seedUrls: string[]
  maxPages?: number
  maxItems?: number
}

export type CrawlerAgentTaskUtilsOptions = {
  maxItems?: number
  maxPages?: number
}

export type CrawlerAgentTaskUtilsItem = Record<string, any>

export function parseChineseNumber(raw: string) {
  const t = String(raw ?? '').trim()
  if (!t) return NaN
  const d: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
  if (/^\d+$/.test(t)) return Number.parseInt(t, 10)
  if (t === '十') return 10
  const bi = t.indexOf('百')
  let total = 0
  let rest = t
  if (bi >= 0) {
    const hRaw = t.slice(0, bi)
    const h = hRaw ? d[hRaw] ?? NaN : 1
    if (!Number.isFinite(h)) return NaN
    total += h * 100
    rest = t.slice(bi + 1)
  }
  const si = rest.indexOf('十')
  if (si >= 0) {
    const sRaw = rest.slice(0, si)
    const s = sRaw ? d[sRaw] ?? NaN : 1
    if (!Number.isFinite(s)) return NaN
    total += s * 10
    const tail = rest.slice(si + 1)
    if (tail) {
      const u = d[tail] ?? NaN
      if (!Number.isFinite(u)) return NaN
      total += u
    }
    return total
  }
  if (rest) {
    const u = d[rest] ?? NaN
    if (!Number.isFinite(u)) return NaN
    total += u
  }
  return total
}

export function extractRequestedLimit(_task: string) {
  /** @deprecated 请用 resolveRequestedLimit / StructuredTaskPlan.limit；不再用正则从正文抽数量 */
  return null
}

/** @deprecated 请用 StructuredTaskPlan.targetSite */
export function isQqMusicTask(_task: string) {
  return false
}

/** @deprecated 请用 StructuredTaskPlan.targetSite */
export function isKugouTask(_task: string) {
  return false
}

/** @deprecated 请用 StructuredTaskPlan.targetSite */
export function isJdTask(_task: string) {
  return false
}

/** @deprecated 请用 StructuredTaskPlan.targetSite */
export function isBilibiliTask(_task: string) {
  return false
}

/** @deprecated 请用 StructuredTaskPlan.targetSite */
export function isWeiboTask(_task: string) {
  return false
}

/** @deprecated 请用 StructuredTaskPlan.targetSite */
export function isZhihuTask(_task: string) {
  return false
}

/** @deprecated 请用 StructuredTaskPlan.targetSite */
export function isToutiaoTask(_task: string) {
  return false
}

/** @deprecated 请用 StructuredTaskPlan.targetSite */
export function isDouyinTask(_task: string) {
  return false
}

/** 由上层判定 openWebSearch 后调用：仅做空白归一与长度截断，不对业务词做模式匹配 */
export function buildBingSearchSeedFromTaskText(task: string): string {
  const raw = String(task ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  const parts = raw.split(/\s*[:：]\s*/)
  const core = parts.length > 1 ? String(parts[parts.length - 1] ?? '').trim() : raw
  const q = (core.length >= 4 ? core : raw).slice(0, 220) || 'web'
  return `https://cn.bing.com/search?q=${encodeURIComponent(q)}`
}

/**
 * 将公网「搜索引擎结果页」种子统一为 cn.bing.com（国内默认可达性更好，避免 Google 在 MCP/机房侧频繁验证码）。
 * 仅按主机名与路径识别，不依赖任务正文或业务关键词。
 */
export function rewriteSearchSerpSeedToCnBing(seedUrl: string): string {
  const raw = String(seedUrl ?? '').trim()
  if (!raw) return raw
  try {
    const u = new URL(raw)
    const host = u.hostname.toLowerCase()
    const path = u.pathname.toLowerCase()

    if (/(^|\.)google\./.test(host) && (path === '/search' || path.startsWith('/search/'))) {
      const q = (u.searchParams.get('q') ?? u.searchParams.get('query') ?? '').trim()
      if (q) return `https://cn.bing.com/search?q=${encodeURIComponent(q)}`
      return raw
    }

    if ((host === 'www.bing.com' || host === 'bing.com') && path.includes('/search')) {
      u.hostname = 'cn.bing.com'
      return u.toString()
    }

    return raw
  } catch {
    return raw
  }
}

export function normalizePlanWithUserLimits<T extends CrawlerAgentTaskUtilsPlan>(
  plan: T,
  task: string,
  options?: CrawlerAgentTaskUtilsOptions
): T {
  // 当有Manager提供的种子URL时，不进行canonicalize，避免被重写为Bing搜索
  const hasManagerSeeds = Array.isArray((options as any)?.__managerSeedUrls) && (options as any).__managerSeedUrls.length > 0
  const seeds = Array.isArray(plan.seedUrls)
    ? hasManagerSeeds 
      ? plan.seedUrls // 保留Manager提供的种子URL，不进行canonicalize
      : plan.seedUrls.map((u) => canonicalizeSeedUrl(task, String(u), (options as any)?.__taskPlan))
    : plan.seedUrls
  const planWithSeeds = { ...plan, seedUrls: seeds } as T

  const fromOptionsRaw = Number(options?.maxItems)
  const explicitFromOptions = Number.isFinite(fromOptionsRaw) && fromOptionsRaw > 0 ? Math.floor(fromOptionsRaw) : null
  const fromTaskPlanRaw = Number((options as any)?.__taskPlan?.limit)
  const fromTaskPlan =
    Number.isFinite(fromTaskPlanRaw) && fromTaskPlanRaw > 0 ? Math.floor(fromTaskPlanRaw) : null
  const requested = explicitFromOptions ?? fromTaskPlan
  if (!requested) {
    const taskPlanEarly = (options as any)?.__taskPlan as { openWebSearch?: boolean } | undefined
    if (taskPlanEarly?.openWebSearch && String((planWithSeeds as any).target ?? '').toLowerCase().includes('generic')) {
      const cur = Number((planWithSeeds as any).maxPages ?? 1)
      const mp = !Number.isFinite(cur) || cur < 6 ? 6 : cur
      return { ...planWithSeeds, maxPages: mp } as T
    }
    return planWithSeeds
  }

  const maxItems = Math.max(1, Math.min(250, requested))
  const next = { ...planWithSeeds, maxItems } as T
  const optionsMaxPagesRaw = Number(options?.maxPages)
  const optionsMaxPages = Number.isFinite(optionsMaxPagesRaw) && optionsMaxPagesRaw > 0 ? Math.floor(optionsMaxPagesRaw) : null
  if (next.target === 'douban_top250' || optionsMaxPages != null) {
    const maxPages = Math.max(1, optionsMaxPages ?? Math.ceil(maxItems / 25))
    next.maxPages = maxPages
    if (next.target === 'douban_top250') {
      next.seedUrls = Array.from({ length: maxPages }, (_, i) => `https://movie.douban.com/top250?start=${i * 25}`)
    }
  }

  const taskPlan = (options as any)?.__taskPlan as { openWebSearch?: boolean } | undefined
  if (taskPlan?.openWebSearch && String((next as any).target ?? '').toLowerCase().includes('generic')) {
    const cur = Number((next as any).maxPages ?? 1)
    if (!Number.isFinite(cur) || cur < 6) (next as any).maxPages = 6
  }

  return next
}

type CanonicalizeTaskPlan = {
  targetSite?: string
  contentType?: string
  openWebSearch?: boolean
} | null | undefined

export function canonicalizeSeedUrl(task: string, seedUrl: string, taskPlan?: CanonicalizeTaskPlan) {
  const taskText = String(task ?? '')
  const raw = rewriteSearchSerpSeedToCnBing(String(seedUrl ?? '').trim())
  if (!raw) return raw

  if (taskPlan?.openWebSearch) {
    return buildBingSearchSeedFromTaskText(taskText)
  }

  if (taskPlan?.targetSite === 'douban') {
    try {
      const u = new URL(raw)
      const host = u.hostname.toLowerCase()
      if (host === 'douban.com' || host === 'www.douban.com') {
        const p = u.pathname.toLowerCase()
        if (p === '/' || p === '' || p.includes('/top250')) {
          return 'https://movie.douban.com/top250'
        }
      }
      if (host === 'movie.douban.com') {
        if (!u.pathname.toLowerCase().includes('/top250')) {
          return 'https://movie.douban.com/top250'
        }
      }
    } catch {}
  }

  const site = String(taskPlan?.targetSite ?? '')
  const content = String(taskPlan?.contentType ?? '')
  if (site === 'qqmusic' && content === 'music') {
    return 'https://y.qq.com/n/ryqq_v2/toplist/26'
  }
  if (site === 'bilibili' && content === 'ranking') {
    return 'https://api.bilibili.com/x/web-interface/ranking/v2?rid=0&type=all'
  }
  if (site === 'weibo' && content === 'ranking') {
    return 'https://s.weibo.com/top/summary?cate=realtimehot'
  }
  if (site === 'zhihu' && content === 'ranking') {
    return 'https://www.zhihu.com/hot'
  }
  if (site === 'toutiao' && content === 'ranking') {
    return 'https://www.toutiao.com/api/pc/hot/hot_board/'
  }
  if (site === 'douyin' && content === 'ranking') {
    return 'https://www.douyin.com/hot?tab=hot'
  }

  try {
    const u = new URL(raw)
    const site = String(taskPlan?.targetSite ?? '').toLowerCase()
    if (site === 'jd') {
      const host = u.hostname.toLowerCase()
      if (host === 'www.jd.com' || host === 'jd.com') {
        return 'https://www.jd.com/phb/key_9987fe5edeab9a4a8355.html'
      }
      return raw
    }
    if (site === 'kugou') {
      if (u.hostname.toLowerCase() === 'www.kugou.com' || u.hostname.toLowerCase() === 'kugou.com') {
        return 'https://m.kugou.com/rank/info/?rankid=8888&page=1&json=true'
      }
      if (u.hostname.toLowerCase() === 'm.kugou.com') {
        if (u.pathname.startsWith('/rank/info/')) {
          const rankid = u.searchParams.get('rankid')
          const page = u.searchParams.get('page') || '1'
          if (rankid) return `https://m.kugou.com/rank/info/?rankid=${encodeURIComponent(rankid)}&page=${encodeURIComponent(page)}&json=true`
          if (u.searchParams.get('json')) return raw
          u.searchParams.set('json', 'true')
          return u.toString()
        }
        if (u.pathname.startsWith('/rank/list')) {
          if (u.searchParams.get('json')) return raw
          u.searchParams.set('json', 'true')
          return u.toString()
        }
      }
    }

    if (u.hostname.toLowerCase() !== 'y.qq.com') return raw
    const mLegacy = u.pathname.match(/^\/n\/ryqq\/toplist\/(\d+)$/i) || u.pathname.match(/^\/n\/ryqq\/topList\/(\d+)$/i)
    if (mLegacy) {
      const oldId = String(mLegacy[1] ?? '')
      const idMap: Record<string, string> = { '1': '26' }
      const newId = idMap[oldId] ?? oldId
      u.pathname = `/n/ryqq_v2/toplist/${newId}`
      u.search = ''
      u.hash = ''
      return u.toString()
    }
    return raw
  } catch {
    return raw
  }
}

export function parseQqMusicToplistId(url: string) {
  const raw = String(url ?? '').trim()
  if (!raw) return null
  try {
    const u = new URL(raw)
    if (u.hostname.toLowerCase() !== 'y.qq.com') return null
    const m = u.pathname.match(/^\/n\/ryqq_v2\/toplist\/(\d+)$/i)
    if (!m) return null
    const id = Number.parseInt(String(m[1] ?? ''), 10)
    return Number.isFinite(id) ? id : null
  } catch {
    return null
  }
}

export function parseKugouRankId(url: string) {
  const raw = String(url ?? '').trim()
  if (!raw) return null
  try {
    const u = new URL(raw)
    if (u.hostname.toLowerCase() !== 'm.kugou.com') return null
    if (!u.pathname.startsWith('/rank/info/')) return null
    const idRaw = u.searchParams.get('rankid')
    const id = idRaw ? Number.parseInt(idRaw, 10) : NaN
    return Number.isFinite(id) ? id : null
  } catch {
    return null
  }
}

export function isBilibiliRankingPageUrl(u: string) {
  try {
    const url = new URL(u)
    if (!/bilibili\.com$/i.test(url.hostname)) return false
    return /\/v\/popular\/rank\/all/i.test(url.pathname)
  } catch {
    return false
  }
}

export function isToutiaoRankingPageUrl(u: string) {
  try {
    const url = new URL(u)
    if (!/toutiao\.com$/i.test(url.hostname)) return false
    return /hot-event\/hot-board/i.test(url.pathname)
  } catch {
    return false
  }
}

export function isZhihuHotPageUrl(u: string) {
  try {
    const url = new URL(u)
    if (!/zhihu\.com$/i.test(url.hostname)) return false
    return /\/hot/i.test(url.pathname)
  } catch {
    return false
  }
}

export function isWeiboRankingPageUrl(u: string) {
  try {
    const url = new URL(u)
    if (!/weibo\.com$/i.test(url.hostname)) return false
    return /\/top\/summary/i.test(url.pathname)
  } catch {
    return false
  }
}

export function isDouyinRankingPageUrl(u: string) {
  try {
    const url = new URL(u)
    if (!/douyin\.com$/i.test(url.hostname)) return false
    return /\/hot/i.test(url.pathname) || /aweme-hotrank/i.test(url.pathname)
  } catch {
    return false
  }
}

export function safeHost(u: string) {
  try {
    return new URL(u).hostname
  } catch {
    return ''
  }
}

export function inferItemTimestamp(item: CrawlerAgentTaskUtilsItem): number | null {
  const candidates = ['publishTime', 'publish_time', 'time', 'date', 'createdAt', 'created_at', 'updatedAt', 'updated_at']
  for (const key of candidates) {
    const raw = item?.[key]
    if (!raw) continue
    const t = Date.parse(String(raw))
    if (Number.isFinite(t)) return t
  }
  return null
}

export function buildRelativeRange(relative: string): { from: number; to: number } | null {
  const text = String(relative ?? '').trim().toLowerCase()
  if (!text) return null
  const now = Date.now()
  const dayMs = 24 * 60 * 60 * 1000
  if (text === 'today') {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return { from: d.getTime(), to: now }
  }
  if (text === 'yesterday') {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    const end = d.getTime() - 1
    return { from: end - dayMs + 1, to: end }
  }
  const cn = text.match(/(?:最近|近)\s*(\d+)\s*(天|周|月|年)/i)
  if (cn) {
    const n = Math.max(1, Number(cn[1]))
    const unit = cn[2]
    const mult = unit === '天' ? 1 : unit === '周' ? 7 : unit === '月' ? 30 : 365
    return { from: now - n * mult * dayMs, to: now }
  }
  const en = text.match(/last\s+(\d+)\s+days?/i)
  if (en) {
    const n = Math.max(1, Number(en[1]))
    return { from: now - n * dayMs, to: now }
  }
  return null
}

export function normalizeRequestedField(field: string) {
  const k = String(field ?? '').trim().toLowerCase()
  if (!k) return ''
  if (k === 'link' || k === 'href' || k === 'source_url') return 'url'
  if (k === 'name') return 'title'
  return k
}
