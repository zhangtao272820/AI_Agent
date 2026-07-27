import { load } from 'cheerio'
import TurndownService from 'turndown'
import type { ChatOpenAI } from '@langchain/openai'

import type { FetchSnapshot } from '../fetch/runtime'
import { extractWithListSelectors } from './patch'
import { resolvePatchForTask } from '../../services/patchRegistry'
import { findHighConfidenceTemplate } from '../../utils/crawl_extract_templates'
import { enrichItemsWithExcerpts, extractArticleExcerpt } from '../../utils/htmlArticleExtract'
import { bumpRunCost } from '../../utils/runCost'
import { isSearchEngineResultUrl, isValidCrawlSeedUrl, normalizeCrawlUrlKey } from '#agent-shared/crawlUrlQuality'

type MovieItem = {
  rank?: number
  title: string
  rating?: number
  quote?: string
  info?: string
  url: string
  [key: string]: any
}

type Plan = {
  seedUrls: string[]
  maxItems?: number
  extraction: {
    entity?: string
    fields: string[]
    vision?: boolean
  }
  templateBlock?: string
}

export type ExtractContext = {
  runCostHost?: Record<string, unknown>
  targetSite?: string
  contentType?: string
}

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced'
})

function safeJsonParse(text: string) {
  try {
    const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/\[\s*\{[\s\S]*\}\s*\]/) || text.match(/\{\s*[\s\S]*\s*\}/)
    const toParse = jsonMatch ? (Array.isArray(jsonMatch) ? jsonMatch[1] || jsonMatch[0] : jsonMatch) : text
    return JSON.parse(toParse)
  } catch {
    return null
  }
}

function normalizeWhitespace(text: string) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function uniqByUrl(items: MovieItem[]) {
  const seen = new Set<string>()
  const out: MovieItem[] = []
  for (const it of items) {
    const k = String(it?.url ?? '').trim()
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(it)
  }
  return out
}

export function extractFromJsonLd(html: string, baseUrl: string, plan: Plan, _task: string) {
  const $ = load(html)
  const scripts = $('script[type="application/ld+json"]')
    .map((_, el) => $(el).text())
    .get()
  const items: MovieItem[] = []
  const push = (title: any, url: any) => {
    const t = normalizeWhitespace(title)
    let u = String(url ?? '').trim()
    if (!t || !u) return
    try {
      u = u.startsWith('http') ? u : new URL(u, baseUrl).toString()
    } catch {}
    items.push({ title: t, url: u, source: 'jsonld' })
  }
  for (const text of scripts) {
    try {
      const data = JSON.parse(text)
      const walk = (node: any) => {
        if (!node) return
        if (Array.isArray(node)) {
          for (const v of node) walk(v)
          return
        }
        if (typeof node === 'object') {
          const t = String((node as any)['@type'] ?? '').toLowerCase()
          if (t === 'itemlist' && Array.isArray((node as any).itemListElement)) {
            for (const it of (node as any).itemListElement) {
              const candidate = it?.item ?? it
              const name = candidate?.name ?? candidate?.title
              const url = candidate?.url ?? candidate?.link
              push(name, url)
              if (items.length >= (plan.maxItems ?? 10)) break
            }
          } else {
            const name = (node as any).name ?? (node as any).title
            const url = (node as any).url ?? (node as any).link
            if (name && url) push(name, url)
          }
          const entries = Object.values(node).slice(0, 40)
          for (const v of entries) walk(v)
        }
      }
      walk(data)
    } catch {}
    if (items.length >= (plan.maxItems ?? 10)) break
  }
  return uniqByUrl(items).slice(0, plan.maxItems ?? 10)
}

export function extractFromMicrodataRdfa(html: string, baseUrl: string, plan: Plan) {
  const $ = load(html)
  const items: MovieItem[] = []
  $('[itemscope]').each((_, el) => {
    const node = $(el)
    const props: Record<string, string> = {}
    node.find('[itemprop]').each((__, p) => {
      const k = String($(p).attr('itemprop') ?? '').trim()
      if (!k) return
      const href = $(p).attr('href') || $(p).attr('content') || $(p).text()
      props[k] = normalizeWhitespace(String(href ?? ''))
    })
    const title = normalizeWhitespace(props['name'] ?? props['title'] ?? '')
    let url = String(props['url'] ?? props['link'] ?? '').trim()
    if (title && url) {
      try {
        url = url.startsWith('http') ? url : new URL(url, baseUrl).toString()
      } catch {}
      if (url) items.push({ title, url, source: 'microdata' })
    }
  })
  $('[typeof]').each((_, el) => {
    const node = $(el)
    const name = normalizeWhitespace(node.attr('property') || '')
    let url = String(node.attr('resource') || node.attr('about') || '').trim()
    if (name && url) {
      try {
        url = url.startsWith('http') ? url : new URL(url, baseUrl).toString()
      } catch {}
      if (url) items.push({ title: name, url, source: 'rdfa' })
    }
  })
  return uniqByUrl(items).slice(0, plan.maxItems ?? 10)
}

export function extractDoubanTop250ListPage(html: string) {
  const $ = load(html)
  const items: MovieItem[] = []
  $('.grid_view .item').each((_, el) => {
    const rankText = normalizeWhitespace($(el).find('.pic em').text())
    const rank = rankText ? Number.parseInt(rankText, 10) : undefined
    const title = normalizeWhitespace($(el).find('.hd .title').first().text())
    const ratingText = normalizeWhitespace($(el).find('.bd .rating_num').text())
    const rating = ratingText ? Number.parseFloat(ratingText) : undefined
    const quote = normalizeWhitespace($(el).find('.bd .inq').text())
    const info = normalizeWhitespace($(el).find('.bd p').first().text())
    const url = String($(el).find('.hd a').attr('href') ?? '').trim()
    if (!title || !url) return
    items.push({ rank, title, rating, quote: quote || undefined, info: info || undefined, url })
  })
  const nextHref = String($('span.next a').attr('href') ?? '').trim()
  const nextUrl = nextHref ? new URL(nextHref, 'https://movie.douban.com/top250').toString() : null
  return { items, nextUrl }
}

export function extractJdPhbListPage(html: string, maxItems: number) {
  const $ = load(html)
  const items: MovieItem[] = []
  const seen = new Set<string>()
  const push = (titleRaw: any, hrefRaw: any) => {
    const title = normalizeWhitespace(titleRaw)
    let href = String(hrefRaw ?? '').trim()
    if (!title || !href) return
    if (href.startsWith('//')) href = `https:${href}`
    if (!/^https?:\/\//i.test(href)) return
    if (!/item\.jd\.com/i.test(href)) return
    if (seen.has(href)) return
    seen.add(href)
    items.push({ rank: items.length + 1, title, url: href, source: 'jd_phb' })
  }

  const selectors = ['.p-name a', '.p-detail a', '.gl-i-wrap .p-name a', 'a[href*="item.jd.com"]']

  for (const sel of selectors) {
    $(sel).each((_, el) => {
      if (items.length >= maxItems) return
      const href = $(el).attr('href')
      const text = $(el).text() || $(el).attr('title')
      push(text, href)
    })
    if (items.length > 0) break
  }

  return { items: items.slice(0, maxItems), nextUrl: null as string | null }
}

function buildTaskKeywords(task: string) {
  const t0 = normalizeWhitespace(task).toLowerCase()
  const tokens = new Set<string>()
  for (const w of t0.split(/[\s,，。;；、|/]+/g)) {
    const x = w.trim()
    if (!x) continue
    if (x.length <= 1) continue
    tokens.add(x)
  }
  const chinese = t0.match(/[\u4e00-\u9fa5]{2,}/g) ?? []
  for (const w of chinese) tokens.add(w)
  const stop = new Set([
    'top',
    '榜',
    '榜单',
    '排行',
    '排行榜',
    '热歌',
    '热歌榜',
    '列表',
    '数据',
    '抓取',
    '爬取',
    '一下',
    '给我',
    '帮我',
    '请',
    '获取',
    '提取',
    '网页',
    '页面',
    '网站',
    'music',
    'kugou',
    '酷狗',
    'qq',
    'qq音乐',
    'y.qq.com',
    'https',
    'http'
  ])
  return [...tokens].filter((x) => !stop.has(x)).slice(0, 12)
}

/**
 * Bing 网页结果常用 `.../ck/a?...&u=...` 包装真实外链；`u` 多为 Base64（常带 2 字节前缀）。
 * 不解码则会被误判为「无效 Bing 内链」而全部丢弃，导致 SERP 解析条数为 0。
 */
export function unwrapBingCkRedirectUrl(href: string): string | null {
  const raw = String(href ?? '').trim()
  if (!raw) return null
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  const host = u.hostname.toLowerCase()
  if (!host.includes('bing.com')) return null
  if (!u.pathname.toLowerCase().includes('/ck/')) return null

  const uParam = u.searchParams.get('u')
  if (!uParam || uParam.length < 6) return null

  const tryDecode = (payload: string): string | null => {
    const p = payload.trim()
    if (!p) return null
    const candidates = [p]
    if (p.length > 2 && /^[a-z0-9]{2}/i.test(p.slice(0, 2))) candidates.push(p.slice(2))
    for (const chunk of candidates) {
      try {
        const pad = '='.repeat((4 - (chunk.length % 4)) % 4)
        const normalized = chunk.replace(/-/g, '+').replace(/_/g, '/')
        const decoded = Buffer.from(normalized + pad, 'base64').toString('utf8').trim()
        if (/^https?:\/\//i.test(decoded)) return decoded
      } catch {
        try {
          const decoded = Buffer.from(chunk, 'base64url').toString('utf8').trim()
          if (/^https?:\/\//i.test(decoded)) return decoded
        } catch {
          /* continue */
        }
      }
    }
    return null
  }

  return tryDecode(uParam)
}

function smartExtractLinksFromHtml(html: string, baseUrl: string, task: string, limit: number) {
  const keywords = buildTaskKeywords(task)
  const $ = load(html)
  $('script, style, iframe, noscript, svg, img').remove()
  $('header, nav, footer, aside, [role="navigation"], .nav, .navbar, .header, .footer, .menu, .breadcrumb').remove()

  const badText = new Set(['首页', '登录', '注册', '下载', '客户端', '帮助', '关于', '隐私', '条款', '反馈', '更多', '我的', '消息'])
  const badPath = /(download|login|logout|signup|register|privacy|terms|help|about|feedback)/i

  type Scored = { score: number; title: string; url: string }
  const seen = new Set<string>()
  const scored: Scored[] = []

  // 从 URL 生成有意义的标题
  const generateTitleFromUrl = (url: string): string => {
    try {
      const u = new URL(url)
      const hostname = u.hostname.replace(/^www\./i, '')
      const pathParts = u.pathname.split('/').filter(Boolean)
      if (pathParts.length > 0) {
        const lastPart = (pathParts[pathParts.length - 1] ?? '').replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ')
        if (lastPart.length >= 3) {
          return `${hostname} - ${lastPart}`
        }
      }
      return hostname
    } catch {
      return url.slice(0, 60)
    }
  }

  const anchors = $('a[href]').toArray()
  for (const el of anchors) {
    const hrefRaw = String($(el).attr('href') ?? '').trim()
    if (!hrefRaw) continue
    if (/^(javascript:|mailto:|tel:|#)/i.test(hrefRaw)) continue

    let abs = ''
    try {
      abs = hrefRaw.startsWith('http') ? hrefRaw : new URL(hrefRaw, baseUrl).toString()
    } catch {
      continue
    }
    if (isSearchEngineResultUrl(abs)) continue
    const bingReal = unwrapBingCkRedirectUrl(abs)
    const linkUrl = String(bingReal || abs).trim()
    if (!linkUrl) continue
    if (seen.has(linkUrl)) continue
    seen.add(linkUrl)

    const text = normalizeWhitespace($(el).text()) || normalizeWhitespace(String($(el).attr('title') ?? '')) || ''
    const txt = text || linkUrl
    const lowerTxt = txt.toLowerCase()

    let score = 0
    if (text && text.length >= 4 && text.length <= 50) score += 2
    if (text && text.length >= 2) score += 1
    if (badText.has(String(text))) score -= 6
    if (badPath.test(linkUrl)) score -= 4
    if ($(el).closest('header, nav, footer, aside, [role="navigation"], .nav, .navbar, .header, .footer, .menu, .breadcrumb').length > 0) score -= 8
    if ($(el).closest('li, article, .item, .card, .list, .content, .container, .main').length > 0) score += 1

    for (const kw of keywords) {
      if (!kw) continue
      if (lowerTxt.includes(kw.toLowerCase())) score += 4
      if (linkUrl.toLowerCase().includes(kw.toLowerCase())) score += 2
    }

    if (score <= 0) continue
    const finalTitle = text || generateTitleFromUrl(linkUrl)
    scored.push({ score, title: finalTitle, url: linkUrl })
  }

  scored.sort((a, b) => b.score - a.score)
  const items: MovieItem[] = scored.slice(0, Math.max(10, limit * 3)).map((x) => ({ title: x.title, url: x.url }))
  return uniqByUrl(items).slice(0, limit)
}

function extractItemsFromNetworkJson(networkJson: any[], baseUrl: string, plan: Plan, task: string) {
  const keywords = buildTaskKeywords(task)
  type Candidate = { score: number; arr: any[]; sourceUrl?: string }
  const candidates: Candidate[] = []

  const pushIfCandidate = (arr: any[], sourceUrl?: string) => {
    if (arr.length < 5 || arr.length > 800) return
    if (typeof arr[0] !== 'object' || arr[0] === null || Array.isArray(arr[0])) return
    let score = 0
    const sample = arr.slice(0, 10)
    for (const it of sample) {
      if (!it || typeof it !== 'object' || Array.isArray(it)) continue
      const keys = Object.keys(it)
      for (const k of keys) {
        const lk = k.toLowerCase()
        if (lk === 'url' || lk === 'link' || lk === 'href') score += 2
        if (lk === 'title' || lk === 'name' || lk === 'songname' || lk === 'song' || lk === 'rank') score += 2
        if (lk.includes('id') || lk.includes('mid')) score += 1
        if (plan.extraction?.fields?.some((f) => String(f).toLowerCase() === lk)) score += 1
      }
      const blob = JSON.stringify(it).toLowerCase()
      for (const kw of keywords) {
        if (kw && blob.includes(kw.toLowerCase())) score += 2
      }
    }
    score += Math.min(50, Math.floor(Math.log(arr.length + 1) * 10))
    if (score > 12) candidates.push({ score, arr, sourceUrl })
  }

  const walk = (node: any, depth: number, sourceUrl?: string) => {
    if (depth > 4) return
    if (node == null) return
    if (Array.isArray(node)) {
      pushIfCandidate(node, sourceUrl)
      for (const x of node.slice(0, 30)) walk(x, depth + 1, sourceUrl)
      return
    }
    if (typeof node === 'object') {
      const entries = Object.entries(node).slice(0, 60)
      for (const [, v] of entries) walk(v, depth + 1, sourceUrl)
    }
  }

  for (const x of networkJson) {
    const data = x?.data ?? x
    walk(data, 0, x?.url)
  }

  if (candidates.length === 0) return []
  candidates.sort((a, b) => b.score - a.score)
  const bestCandidate = candidates[0]
  if (!bestCandidate) return []
  const best = bestCandidate.arr

  const items: MovieItem[] = []
  for (const raw of best) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const title = normalizeWhitespace((raw as any).title ?? (raw as any).name ?? (raw as any).songname ?? (raw as any).songName ?? '')
    let url = String((raw as any).url ?? (raw as any).link ?? (raw as any).href ?? '').trim()
    const songmid = String((raw as any).songmid ?? (raw as any).mid ?? '').trim()
    if (!url && songmid && /y\.qq\.com/i.test(baseUrl)) {
      url = `https://y.qq.com/n/yqq/song/${songmid}.html`
    }
    if (!title || !url) continue
    try {
      url = url.startsWith('http') ? url : new URL(url, baseUrl).toString()
    } catch {}
    items.push({ title, url, source: 'network_json' })
    if (items.length >= (plan.maxItems ?? 10)) break
  }
  return uniqByUrl(items).slice(0, plan.maxItems ?? 10)
}

function looksLikeMostlyNavigation(items: MovieItem[]) {
  if (items.length < 5) return true
  const bad = /(download|vipportal|profile|category|radio|artists|singer|album|portal|help|about|privacy|terms)/i
  const badCount = items.filter((x) => bad.test(String(x.url ?? ''))).length
  return badCount / Math.max(1, items.length) >= 0.5
}

/**
 * Manager seed-first：每颗种子只产出 1 条正文 item，禁止从门户/SERP 页抽导航热搜链。
 */
export function extractSeedPageAsSingleItem(
  snapshot: FetchSnapshot,
  seedUrl: string,
  serpFallback?: { title?: string; snippet?: string },
): MovieItem | null {
  const pageUrl = String(snapshot.finalUrl || seedUrl || '').trim()
  if (!pageUrl || !isValidCrawlSeedUrl(pageUrl)) return null
  if (isSearchEngineResultUrl(pageUrl)) return null

  const title = normalizeWhitespace(snapshot.title || serpFallback?.title || pageUrl).slice(0, 200)
  let excerpt = extractArticleExcerpt(snapshot.html)
  const serpSnip = String(serpFallback?.snippet ?? '').trim()
  if ((!excerpt || excerpt.length < 40) && serpSnip.length >= 12) excerpt = serpSnip
  if (!excerpt || excerpt.length < 20) return null

  let source = ''
  try {
    source = new URL(pageUrl).hostname.replace(/^www\./i, '')
  } catch {
    source = ''
  }

  return {
    title,
    url: pageUrl,
    source,
    excerpt: excerpt.slice(0, 400),
    excerpt_source: serpSnip && excerpt === serpSnip ? 'manager_serp' : 'page',
  }
}

function filterCrawlOutputItems(items: MovieItem[]): MovieItem[] {
  return items.filter((it) => {
    const url = String(it.url ?? '').trim()
    if (!url) return true
    if (!/^https?:\/\//i.test(url)) return false
    return !isSearchEngineResultUrl(url)
  })
}

/** 将抓取结果约束在 Manager 种子 + SERP 命中范围内，剔除误抽的热搜/导航链 */
export function constrainItemsToManagerScope(
  items: MovieItem[],
  seedUrls: string[],
  serpUrls: string[],
  maxItems: number,
): MovieItem[] {
  const allowed = new Set<string>()
  for (const u of [...seedUrls, ...serpUrls]) {
    const key = normalizeCrawlUrlKey(String(u ?? '').trim())
    if (key) allowed.add(key)
  }
  const filtered = filterCrawlOutputItems(items).filter((it) => {
    const url = String(it.url ?? '').trim()
    if (!url) return false
    if (!allowed.size) return true
    return allowed.has(normalizeCrawlUrlKey(url))
  })
  return uniqByUrl(filtered.length ? filtered : filterCrawlOutputItems(items)).slice(0, maxItems)
}

/** Bing 网页搜索结果列表（兼容多版 DOM） */
export function extractBingSerpLinks(html: string, baseUrl: string, maxItems: number): MovieItem[] {
  const $ = load(html)
  const items: MovieItem[] = []
  const push = (title: string, href: string, excerpt?: string) => {
    let t = normalizeWhitespace(title)
    let u = String(href ?? '').trim()
    if (!u) return
    if (u.startsWith('/fd/ls/')) return
    try {
      u = u.startsWith('http') ? u : new URL(u, baseUrl).toString()
    } catch {
      return
    }
    if (!/^https?:\/\//i.test(u)) return
    if (isSearchEngineResultUrl(u)) return

    const unwrapped = unwrapBingCkRedirectUrl(u)
    if (unwrapped) u = unwrapped
    else if (/bing\.com\/ck/i.test(u)) return

    if (!t) {
      try {
        t = normalizeWhitespace(new URL(u).hostname.replace(/^www\./i, ''))
      } catch {
        t = u.slice(0, 60)
      }
    }
    if (!t) return

    const ex = normalizeWhitespace(String(excerpt ?? ''))
    const row: MovieItem = { title: t, url: u, source: 'bing_serp' }
    if (ex) row.excerpt = ex
    items.push(row)
  }

  $('li.b_algo').each((_, li) => {
    const $li = $(li)
    const a = $li.find('h2 a').first()
    const title = String(a.text() ?? '')
    const href = String(a.attr('href') ?? '')
    const snippet = normalizeWhitespace(
      $li.find('.b_caption, .b_snippet, .b_lineclamp2, .b_algoSlug, .b_datalayer, div.b_caption p, p').first().text()
    )
    if (title && href) push(title, href, snippet || undefined)
  })

  const primarySelectors = [
    '#b_results li.b_algo h2 a',
    'ol#b_results li.b_algo h2 a',
    'li.b_algo h2 a',
    'li.b_algo .b_tpcn + h2 a',
    '.b_algoheader h2 a'
  ]
  if (items.length < 3) {
    for (const sel of primarySelectors) {
      $(sel).each((_, el) => {
        const $el = $(el)
        const $li = $el.closest('li.b_algo')
        const snippet = $li.length
          ? normalizeWhitespace(
              $li.find('.b_caption, .b_snippet, .b_lineclamp2, .b_algoSlug, div.b_caption p, p').first().text()
            )
          : ''
        push($el.text() || '', String($el.attr('href') ?? ''), snippet || undefined)
      })
      if (items.length >= 3) break
    }
  }
  if (items.length < 3) {
    $('h2 a').each((_, el) => {
      const p = $(el).closest('li')
      if (!p.length || !p.attr('class')?.includes('algo')) return
      push($(el).text() || '', String($(el).attr('href') ?? ''))
    })
  }
  if (items.length < 2) {
    $('.b_title a, a.tilk').each((_, el) => {
      push($(el).text() || '', String($(el).attr('href') ?? ''))
    })
  }
  if (items.length === 0) {
    $('a[href]').each((_, el) => {
      const href = String($(el).attr('href') ?? '').trim()
      if (!href.includes('/ck/') && !/bing\.com\/ck/i.test(href)) return
      let title = normalizeWhitespace($(el).text())
      if (!title) title = normalizeWhitespace($(el).closest('li').find('h2').first().text())
      push(title, href)
    })
  }
  return uniqByUrl(items).slice(0, Math.max(1, Math.min(30, maxItems)))
}

export async function extractGenericListPage(
  snapshot: FetchSnapshot,
  plan: Plan,
  model: ChatOpenAI | null,
  task: string,
  ctx?: ExtractContext,
): Promise<{ items: MovieItem[]; nextUrl: string | null; extractPath?: string }> {
  const costHost = ctx?.runCostHost
  const bump = (p: Parameters<typeof bumpRunCost>[1]) => bumpRunCost(costHost, p)
  const $ = load(snapshot.html)

  let nextUrl: string | null = null
  const nextSelectors = ['a:contains("下一页")', 'a:contains("Next")', 'a[rel="next"]', '.next a', 'a:contains(">")']
  for (const sel of nextSelectors) {
    const href = $(sel).attr('href')
    if (href) {
      try {
        const base = String((snapshot.finalUrl || plan.seedUrls?.[0]) ?? '').trim()
        if (!base) continue
        nextUrl = href.startsWith('http') ? href : new URL(href, base).toString()
        break
      } catch {}
    }
  }

  const seed0 = String(plan.seedUrls?.[0] ?? '').trim()
  const finalU = String(snapshot.finalUrl ?? '').trim()
  const isBingSearchUrl = (s: string) => {
    try {
      const u = new URL(s)
      return u.hostname.toLowerCase().includes('bing.com') && /\/search/i.test(`${u.pathname}${u.search}`)
    } catch {
      return false
    }
  }
  let baseForExtract = String((snapshot.finalUrl || plan.seedUrls?.[0]) ?? '').trim()
  const htmlLooksLikeBingSerp = /b_algo|["']b_results["']|id\s*=\s*["']b_results["']/i.test(snapshot.html)
  if (htmlLooksLikeBingSerp && seed0 && isBingSearchUrl(seed0) && (!baseForExtract || !isBingSearchUrl(baseForExtract))) {
    baseForExtract = seed0
  }
  let bingSerpItems: MovieItem[] = []
  if (baseForExtract && /^https?:\/\//i.test(baseForExtract)) {
    try {
      const u = new URL(baseForExtract)
      const host = u.hostname.toLowerCase()
      if (host.includes('bing.com') && (/\/search/i.test(`${u.pathname}${u.search}`) || htmlLooksLikeBingSerp)) {
        const serpBase = isBingSearchUrl(baseForExtract) ? baseForExtract : seed0 || baseForExtract
        bingSerpItems = extractBingSerpLinks(snapshot.html, serpBase, plan.maxItems ?? 10)
      }
    } catch {
      /* ignore */
    }
  }
  if (bingSerpItems.length > 0) {
    bump({ extract_path: 'bing_serp', rule_extract_attempts: 1 })
    return { items: uniqByUrl(bingSerpItems).slice(0, plan.maxItems ?? 10), nextUrl, extractPath: 'bing_serp' }
  }

  const baseUrl = baseForExtract
  const patch = resolvePatchForTask(ctx?.targetSite, ctx?.contentType, baseUrl)
  if (patch?.listSelectors?.item) {
    bump({ rule_extract_attempts: 1 })
    const patchItems = extractWithListSelectors(snapshot.html, baseUrl, patch.listSelectors, plan.maxItems ?? 10)
    if (patchItems.length >= 2) {
      bump({ patch_hit: true, patch_id: patch.id, extract_path: 'patch' })
      const items = enrichItemsWithExcerpts(
        patchItems as Array<Record<string, unknown>>,
        snapshot.html,
        patch.articleSelectors,
      ) as MovieItem[]
      return { items: uniqByUrl(items).slice(0, plan.maxItems ?? 10), nextUrl, extractPath: 'patch' }
    }
  }

  const fallbackExtract = () => smartExtractLinksFromHtml(snapshot.html, baseForExtract, task, plan.maxItems ?? 10)
  const networkExtract = () => extractItemsFromNetworkJson(snapshot.networkJson ?? [], baseForExtract, plan, task)
  const jsonLdExtract = () => extractFromJsonLd(snapshot.html, baseForExtract, plan, task)

  const tryRulePipeline = (minItems: number, pathPrefix: string): MovieItem[] | null => {
    bump({ rule_extract_attempts: 1 })
    const netItems = networkExtract()
    if (netItems.length >= minItems && !looksLikeMostlyNavigation(netItems)) return netItems
    const ldItems = jsonLdExtract()
    if (ldItems.length >= minItems && !looksLikeMostlyNavigation(ldItems)) return ldItems
    const microItems = extractFromMicrodataRdfa(snapshot.html, baseForExtract, plan)
    if (microItems.length >= minItems && !looksLikeMostlyNavigation(microItems)) return microItems
    const fb = fallbackExtract()
    if (fb.length >= minItems && !looksLikeMostlyNavigation(fb)) return fb
    return null
  }

  const templateHit = findHighConfidenceTemplate(task, ctx?.targetSite)
  if (templateHit) {
    bump({ template_hit: true })
    const ruled = tryRulePipeline(3, 'template')
    if (ruled?.length) {
      bump({ extract_path: 'template' })
      const items = enrichItemsWithExcerpts(ruled as Array<Record<string, unknown>>, snapshot.html, patch?.articleSelectors) as MovieItem[]
      return { items: uniqByUrl(items).slice(0, plan.maxItems ?? 10), nextUrl, extractPath: 'template' }
    }
  }

  const ruledBeforeLlm = tryRulePipeline(5, 'rule')
  if (ruledBeforeLlm?.length) {
    bump({ extract_path: 'rule' })
    const items = enrichItemsWithExcerpts(ruledBeforeLlm as Array<Record<string, unknown>>, snapshot.html, patch?.articleSelectors) as MovieItem[]
    return { items: uniqByUrl(items).slice(0, plan.maxItems ?? 10), nextUrl, extractPath: 'rule' }
  }

  if (!model) {
    bump({ extract_path: 'heuristic' })
    return { items: fallbackExtract(), nextUrl, extractPath: 'heuristic' }
  }

  const imageUrls = (() => {
    if (!plan.extraction.vision) return [] as string[]
    const raw = $('img')
      .map((_, el) => String($(el).attr('src') ?? '').trim())
      .get()
      .filter(Boolean)
      .slice(0, 5)
    const out: string[] = []
    for (const u of raw) {
      try {
        out.push(u.startsWith('http') ? u : new URL(u, baseForExtract).toString())
      } catch {}
    }
    return out
  })()

  $('script, style, iframe, noscript, footer, header, nav, svg, img').remove()
  const cleanHtml = $('body').html() || ''
  const markdown = turndown.turndown(cleanHtml).substring(0, 15000)

  try {
    const fields = Array.isArray(plan.extraction?.fields) && plan.extraction.fields.length > 0 ? plan.extraction.fields : ['title', 'url']
    const limit = Number(plan.maxItems ?? 10)
    const messages: any[] = [
      [
        'human',
        [
          'You are a strict information extraction engine.',
          `Task: ${normalizeWhitespace(task)}`,
          `Entity: ${normalizeWhitespace(plan.extraction?.entity ?? 'item')}`,
          `Return up to ${limit} items.`,
          `Required fields: ${fields.map(String).join(', ')}.`,
          plan.templateBlock ? `${plan.templateBlock}\n` : '',
          'Rules:',
          '- Return ONLY a JSON array (no markdown, no code fences, no extra text).',
          '- Each element must be an object.',
          '- Each element MUST include at least: title, url.',
          '- If a field is not found, omit that field (do not hallucinate).',
          '- Prefer main content items over navigation links.',
          '',
          `Content:\n---\n${markdown}\n---`
        ].join('\n')
      ]
    ]
    if (plan.extraction.vision && imageUrls.length > 0) {
      messages.push(['human', 'Images on the page:'])
      for (const url of imageUrls) {
        try {
          messages.push(['human', { type: 'image_url', image_url: { url } }])
        } catch {}
      }
    }

    const response = await model.invoke(messages)
    bump({ llm_extract_calls: 1, extract_path: 'llm' })
    const items = safeJsonParse(String((response as any).content ?? '').trim())
    const parsed = Array.isArray(items) ? (items as any[]) : []
    const normalized = parsed
      .map((x) => {
        const title = normalizeWhitespace((x as any)?.title ?? (x as any)?.name ?? '')
        const url = String((x as any)?.url ?? (x as any)?.link ?? (x as any)?.href ?? '').trim()
        if (!title || !url) return null
        try {
          const abs = url.startsWith('http') ? url : new URL(url, baseForExtract).toString()
          return { ...(x as any), title, url: abs }
        } catch {
          return null
        }
      })
      .filter(Boolean) as MovieItem[]
    const llmItems = uniqByUrl(normalized).slice(0, plan.maxItems ?? 10)
    if (llmItems.length >= 5 && !looksLikeMostlyNavigation(llmItems)) {
      const enriched = enrichItemsWithExcerpts(llmItems as Array<Record<string, unknown>>, snapshot.html, patch?.articleSelectors) as MovieItem[]
      return { items: enriched, nextUrl, extractPath: 'llm' }
    }
    const ruledAfter = tryRulePipeline(3, 'rule_fallback')
    if (ruledAfter?.length) {
      bump({ extract_path: 'rule_fallback' })
      return { items: ruledAfter, nextUrl, extractPath: 'rule_fallback' }
    }
    return {
      items: enrichItemsWithExcerpts(
        (llmItems.length > 0 ? llmItems : fallbackExtract()) as Array<Record<string, unknown>>,
        snapshot.html,
        patch?.articleSelectors,
      ) as MovieItem[],
      nextUrl,
      extractPath: llmItems.length > 0 ? 'llm' : 'heuristic',
    }
  } catch {
    const ruledAfter = tryRulePipeline(3, 'rule_error_fallback')
    if (ruledAfter?.length) return { items: ruledAfter, nextUrl, extractPath: 'rule_error_fallback' }
    return { items: fallbackExtract(), nextUrl, extractPath: 'heuristic' }
  }
}

