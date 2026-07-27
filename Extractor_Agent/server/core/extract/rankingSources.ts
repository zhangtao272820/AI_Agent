import { load } from 'cheerio'

type RankingItem = {
  rank?: number
  title: string
  url: string
  [key: string]: any
}

function normalizeWhitespace(text: string) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

function safeJsonParse(text: string) {
  try {
    const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/\[\s*\{[\s\S]*\}\s*\]/) || text.match(/\{\s*[\s\S]*\s*\}/)
    const toParse = jsonMatch ? (Array.isArray(jsonMatch) ? jsonMatch[1] || jsonMatch[0] : jsonMatch) : text
    return JSON.parse(toParse)
  } catch {
    return null
  }
}

export async function fetchQqMusicToplist(topId: number, userAgent: string | undefined, signal: AbortSignal) {
  const url = `https://c.y.qq.com/v8/fcg-bin/fcg_v8_toplist_cp.fcg?format=json&topid=${encodeURIComponent(String(topId))}`
  const res = await fetch(url, {
    signal,
    redirect: 'follow',
    headers: {
      'user-agent': userAgent || '',
      referer: 'https://y.qq.com/'
    }
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`QQMusic toplist API failed: HTTP ${res.status}; body=${body.slice(0, 160)}`)
  }
  return (await res.json()) as any
}

export async function fetchKugouRankInfo(rankId: number, page: number, userAgent: string | undefined, signal: AbortSignal) {
  const url = `https://m.kugou.com/rank/info/?rankid=${encodeURIComponent(String(rankId))}&page=${encodeURIComponent(String(page))}&json=true`
  const res = await fetch(url, {
    signal,
    redirect: 'follow',
    headers: {
      'user-agent': userAgent || '',
      referer: 'https://m.kugou.com/'
    }
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Kugou rank API failed: HTTP ${res.status}; body=${body.slice(0, 160)}`)
  }
  try {
    return (await res.json()) as any
  } catch {
    const text = await res.text().catch(() => '')
    const parsed = safeJsonParse(text)
    if (parsed) return parsed as any
    throw new Error(`Kugou rank API returned non-JSON: body=${text.slice(0, 160)}`)
  }
}

export function extractQqMusicToplistItems(topId: number, payload: any, maxItems: number): RankingItem[] {
  const list = Array.isArray(payload?.songlist) ? payload.songlist : []
  const items: RankingItem[] = []
  for (const entry of list) {
    const data = entry?.data ?? {}
    const songmid = String(data?.songmid ?? '').trim()
    const title = normalizeWhitespace(data?.songname ?? '')
    const singers = Array.isArray(data?.singer) ? data.singer : []
    const artist = normalizeWhitespace(singers.map((s: any) => s?.name || s?.title).filter(Boolean).join(' / '))
    if (!title || !songmid) continue
    const rankRaw = entry?.cur_count ?? entry?.Franking_value ?? entry?.rank ?? undefined
    const rank = rankRaw ? Number.parseInt(String(rankRaw), 10) : undefined
    const songUrl = `https://y.qq.com/n/yqq/song/${songmid}.html`
    items.push({
      rank: Number.isFinite(rank as any) ? (rank as number) : undefined,
      title,
      artist: artist || undefined,
      url: songUrl,
      source: 'qqmusic_toplist',
      topId
    })
    if (items.length >= maxItems) break
  }
  return items
}

export function extractKugouRankItems(rankId: number, payload: any, maxItems: number): RankingItem[] {
  const list = Array.isArray(payload?.songs?.list) ? payload.songs.list : []
  const items: RankingItem[] = []
  for (const entry of list) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const title = normalizeWhitespace((entry as any).songname ?? '')
    const filename = normalizeWhitespace((entry as any).filename ?? '')
    const artist = normalizeWhitespace((entry as any).h5_author_name ?? '')
    const songUrl = String((entry as any).song_url ?? '').trim()
    const rankRaw = (entry as any).sort ?? (entry as any).rank_count ?? undefined
    const rank = rankRaw != null ? Number.parseInt(String(rankRaw), 10) : undefined
    const inferredArtist = (() => {
      const m = filename.match(/^\s*(.+?)\s*-\s*(.+?)\s*$/)
      if (!m) return ''
      return normalizeWhitespace(m[1] || '')
    })()
    const inferredTitle = (() => {
      const m = filename.match(/^\s*(.+?)\s*-\s*(.+?)\s*$/)
      if (!m) return ''
      return normalizeWhitespace(m[2] || '')
    })()
    const finalTitle = title || inferredTitle
    const finalArtist = artist || inferredArtist
    if (!finalTitle || !songUrl) continue
    items.push({
      rank: Number.isFinite(rank as any) ? (rank as number) : undefined,
      title: finalTitle,
      artist: finalArtist || undefined,
      url: songUrl,
      source: 'kugou_rank',
      rankId
    })
    if (items.length >= maxItems) break
  }
  return items
}

export async function fetchBilibiliRankingAll(userAgent: string | undefined, signal: AbortSignal) {
  const url = 'https://api.bilibili.com/x/web-interface/ranking/v2?rid=0&type=all'
  const res = await fetch(url, {
    signal,
    redirect: 'follow',
    headers: {
      'user-agent': userAgent || '',
      referer: 'https://www.bilibili.com/'
    }
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Bilibili ranking API failed: HTTP ${res.status}; body=${body.slice(0, 160)}`)
  }
  return (await res.json()) as any
}

export function extractBilibiliRankItems(payload: any, maxItems: number): RankingItem[] {
  if (payload && typeof payload === 'object') {
    const code = Number((payload as any).code ?? 0)
    if (Number.isFinite(code) && code !== 0) return []
  }
  const list = Array.isArray(payload?.data?.list) ? payload.data.list : Array.isArray(payload?.data?.list?.list) ? payload.data.list.list : []
  const items: RankingItem[] = []
  for (const it of list) {
    if (!it || typeof it !== 'object' || Array.isArray(it)) continue
    const title = normalizeWhitespace((it as any).title ?? (it as any).short_link_title ?? '')
    const bvid = String((it as any).bvid ?? (it as any).bv_id ?? '').trim()
    const stat = (it as any).stat || {}
    const view = stat.view ?? stat.play ?? (it as any).play ?? (it as any).views
    const rank = (it as any).rank ?? (it as any).stat?.his_rank ?? undefined
    if (!title || !bvid) continue
    const url = `https://www.bilibili.com/video/${bvid}`
    const item: RankingItem = { title, url }
    if (Number.isFinite(Number(rank))) (item as any).rank = Number(rank)
    if (Number.isFinite(Number(view))) (item as any).views = Number(view)
    items.push(item)
    if (items.length >= maxItems) break
  }
  return items
}

export function extractBilibiliRankFromHtml(html: string, maxItems: number) {
  const $ = load(html)
  const items: RankingItem[] = []
  const seen = new Set<string>()
  $('a[href*="/video/BV"]').each((_, el) => {
    if (items.length >= maxItems) return
    let href = String($(el).attr('href') || '').trim()
    const title = normalizeWhitespace($(el).attr('title') || $(el).text() || '')
    if (!href || !title) return
    try {
      href = href.startsWith('http') ? href : new URL(href, 'https://www.bilibili.com/').toString()
    } catch {
      return
    }
    if (seen.has(href)) return
    seen.add(href)
    const item: RankingItem = { title, url: href }
    const container = $(el).closest('.rank-item,.content,.video-item,.detail,.info,.detail-info')
    const text = normalizeWhitespace(container.text())
    const m = text.match(/(\d[\d,\.]*)\s*(播放|views?)/i)
    if (m) {
      const v = Number(String(m[1]).replace(/[,\s]/g, ''))
      if (Number.isFinite(v)) (item as any).views = v
    }
    items.push(item)
  })
  return items.slice(0, maxItems)
}

export async function fetchZhihuHot(
  userAgent: string | undefined,
  signal: AbortSignal,
  cookies?: Array<{ name?: string; value?: string }>,
) {
  const url = 'https://www.zhihu.com/api/v3/feed/topstory/hot-lists/total?limit=50&desktop=true'
  const cookieHeader = Array.isArray(cookies)
    ? cookies
        .map((c) => `${String(c?.name ?? '').trim()}=${String(c?.value ?? '').trim()}`)
        .filter((x) => x !== '=' && !x.startsWith('='))
        .join('; ')
    : ''
  const res = await fetch(url, {
    signal,
    redirect: 'follow',
    headers: {
      'user-agent':
        userAgent ||
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      referer: 'https://www.zhihu.com/hot',
      accept: 'application/json, text/plain, */*',
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.7',
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
    },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Zhihu hot API failed: HTTP ${res.status}; body=${body.slice(0, 160)}`)
  }
  return (await res.json()) as any
}

export const ZHIHU_HOT_PAGE_URL = 'https://www.zhihu.com/hot'

export function isZhihuHotTaskUrl(url: string) {
  return /zhihu\.com\/(hot(?:\/|$|\?)|api\/v3\/feed\/topstory\/hot-lists)/i.test(String(url ?? ''))
}

export function extractZhihuHotFromNetworkJson(networkJson: any[], maxItems: number): RankingItem[] {
  if (!Array.isArray(networkJson)) return []
  for (const entry of networkJson) {
    const respUrl = String(entry?.url ?? '')
    if (!/hot-lists/i.test(respUrl)) continue
    const payload = entry?.data ?? entry
    const items = extractZhihuHotItems(payload, maxItems)
    if (items.length > 0) return items
  }
  return []
}

export function extractZhihuHotFromEmbeddedJson(html: string, maxItems: number): RankingItem[] {
  const h = String(html ?? '')
  const patterns = [
    /"hotList"\s*:\s*(\[[\s\S]{80,80000}?\])\s*[,}]/,
    /"data"\s*:\s*(\[[\s\S]{80,80000}?"type"\s*:\s*"hot_list_feed"[\s\S]*?\])\s*[,}]/,
  ]
  for (const re of patterns) {
    const m = h.match(re)
    if (!m?.[1]) continue
    try {
      const arr = JSON.parse(m[1])
      if (!Array.isArray(arr)) continue
      const items = extractZhihuHotItems({ data: arr }, maxItems)
      if (items.length > 0) return items
    } catch {}
  }
  return []
}

export type ZhihuHotResolveDeps = {
  userAgent?: string
  signal: AbortSignal
  session?: { cookies?: any[] } | null
  maxItems: number
  emitLog?: (level: 'info' | 'warn', msg: string) => void
  fetchPage: (pageUrl: string, useBrowser: boolean) => Promise<{ html: string; networkJson: any[] }>
}

/** 成熟路径：Cookie API → Browser /hot + XHR 拦截 → 内嵌 JSON → HTML */
export async function resolveZhihuHotItems(deps: ZhihuHotResolveDeps): Promise<RankingItem[]> {
  const cookies = Array.isArray(deps.session?.cookies) ? deps.session!.cookies : []
  const log = deps.emitLog ?? (() => {})

  if (cookies.length > 0) {
    try {
      const payload = await fetchZhihuHot(deps.userAgent, deps.signal, cookies)
      const items = extractZhihuHotItems(payload, deps.maxItems)
      if (items.length > 0) {
        log('info', `Zhihu：Cookie API 命中 ${items.length} 条`)
        return items
      }
    } catch (e: any) {
      log('warn', `Zhihu：Cookie API 未命中（${String(e?.message ?? e).slice(0, 80)}）`)
    }
  }

  try {
    log('info', 'Zhihu：浏览器打开热榜页并拦截 XHR')
    const snap = await deps.fetchPage(ZHIHU_HOT_PAGE_URL, true)
    const fromNet = extractZhihuHotFromNetworkJson(snap.networkJson ?? [], deps.maxItems)
    if (fromNet.length > 0) {
      log('info', `Zhihu：XHR 拦截命中 ${fromNet.length} 条`)
      return fromNet
    }
    const fromEmbed = extractZhihuHotFromPageContent(snap.html, deps.maxItems)
    if (fromEmbed.length > 0) {
      log('info', `Zhihu：页面内容解析命中 ${fromEmbed.length} 条`)
      return fromEmbed
    }
  } catch (e: any) {
    log('warn', `Zhihu：浏览器热榜抓取失败（${String(e?.message ?? e).slice(0, 100)}）`)
  }

  try {
    const payload = await fetchZhihuHot(deps.userAgent, deps.signal)
    const items = extractZhihuHotItems(payload, deps.maxItems)
    if (items.length > 0) return items
  } catch {}

  return []
}

export function extractZhihuHotItems(payload: any, maxItems: number): RankingItem[] {
  const list = Array.isArray(payload?.data) ? payload.data : []
  const items: RankingItem[] = []
  for (const it of list) {
    const t = it?.target || it?.children?.[0]?.target || it
    const title = normalizeWhitespace(t?.title || t?.question?.title || t?.card?.title || '')
    let url = String(t?.url || t?.link?.url || '').trim()
    const qid = t?.question?.id || t?.id
    if (!url && qid) url = `https://www.zhihu.com/question/${qid}`
    if (!title || !url) continue
    const hot = t?.metrics_area?.text || t?.detail_text || ''
    const item: RankingItem = { title, url }
    if (hot) (item as any).heat = hot
    items.push(item)
    if (items.length >= maxItems) break
  }
  return items
}

export function extractZhihuHotFromLooseFeed(html: string, maxItems: number): RankingItem[] {
  const h = String(html ?? '')
  const items: RankingItem[] = []
  const seen = new Set<string>()
  const chunks = h.split('hot_list_feed')
  for (let i = 1; i < chunks.length && items.length < maxItems; i++) {
    const chunk = chunks[i]!.slice(0, 4000)
    const titleM = chunk.match(/"title"\s*:\s*"((?:\\.|[^"\\])*)"/)
    const urlM =
      chunk.match(/"url"\s*:\s*"((?:\\.|[^"\\])*)"/) ||
      chunk.match(/"link"\s*:\s*\{[^}]*"url"\s*:\s*"((?:\\.|[^"\\])*)"/)
    const qidM = chunk.match(/"question"\s*:\s*\{[^}]*"id"\s*:\s*(\d+)/) || chunk.match(/"id"\s*:\s*(\d{6,})/)
    let title = ''
    let url = ''
    try {
      if (titleM?.[1]) title = JSON.parse(`"${titleM[1]}"`)
    } catch {
      title = String(titleM?.[1] ?? '').replace(/\\"/g, '"')
    }
    if (urlM?.[1]) {
      try {
        url = JSON.parse(`"${urlM[1]}"`)
      } catch {
        url = String(urlM[1]).replace(/\\\//g, '/')
      }
    }
    if (!url && qidM?.[1]) url = `https://www.zhihu.com/question/${qidM[1]}`
    title = normalizeWhitespace(title)
    if (!title || !url || title.length < 2) continue
    if (seen.has(url)) continue
    seen.add(url)
    items.push({ title, url })
  }
  return items.slice(0, maxItems)
}

export function extractZhihuHotFromMarkdown(md: string, maxItems: number): RankingItem[] {
  const items: RankingItem[] = []
  const seen = new Set<string>()
  const linkRe = /\[([^\]]{4,200})\]\((https?:\/\/(?:www\.)?zhihu\.com\/question\/\d+[^)]*)\)/g
  let m: RegExpExecArray | null
  while ((m = linkRe.exec(String(md ?? ''))) && items.length < maxItems) {
    const title = normalizeWhitespace(m[1])
    const url = m[2]!.split(')')[0]!
    if (!title || seen.has(url)) continue
    seen.add(url)
    items.push({ title, url })
  }
  return items
}

export function extractZhihuHotFromInitialData(html: string, maxItems: number): RankingItem[] {
  const m = html.match(/id=["']js-initialData["'][^>]*>([\s\S]*?)<\/script>/i)
  if (!m?.[1]) return []
  const items: RankingItem[] = []
  const seen = new Set<string>()
  const walk = (node: any, depth: number) => {
    if (depth > 10 || items.length >= maxItems) return
    if (node == null) return
    if (Array.isArray(node)) {
      for (const x of node.slice(0, 80)) walk(x, depth + 1)
      return
    }
    if (typeof node !== 'object') return
    const title = normalizeWhitespace(
      node?.title || node?.target?.title || node?.question?.title || node?.card?.title || '',
    )
    let url = String(node?.url || node?.target?.url || node?.link?.url || '').trim()
    const qid = node?.question?.id || node?.target?.question?.id || node?.target?.id
    if (!url && qid) url = `https://www.zhihu.com/question/${qid}`
    if (title && url && title.length > 2) {
      try {
        url = url.startsWith('http') ? url : new URL(url, 'https://www.zhihu.com/').toString()
      } catch {
        url = ''
      }
      if (url && /zhihu\.com/i.test(url) && !seen.has(url)) {
        seen.add(url)
        items.push({ title, url })
      }
    }
    for (const v of Object.values(node).slice(0, 50)) walk(v, depth + 1)
  }
  try {
    walk(JSON.parse(m[1].trim()), 0)
  } catch {}
  return items.slice(0, maxItems)
}

export function extractZhihuHotFromPageContent(html: string, maxItems: number): RankingItem[] {
  const inline = tryParseInlineHotJson(html)
  if (inline) {
    const fromInline = extractZhihuHotItems(inline, maxItems)
    if (fromInline.length > 0) return fromInline
  }
  for (const fn of [
    () => extractZhihuHotFromInitialData(html, maxItems),
    () => extractZhihuHotFromMarkdown(html, maxItems),
    () => extractZhihuHotFromEmbeddedJson(html, maxItems),
    () => extractZhihuHotFromLooseFeed(html, maxItems),
    () => extractZhihuHotFromHtml(html, maxItems),
  ]) {
    const items = fn()
    if (items.length > 0) return items
  }
  return []
}

function tryParseInlineHotJson(html: string): any {
  const h = String(html ?? '')
  const m = h.match(/hot-lists\/total[^"'\\n]{0,120}[\s\S]{0,2000}?"data"\s*:\s*(\[[\s\S]*?\])\s*[,}]/)
  if (!m?.[1]) return null
  try {
    return { data: JSON.parse(m[1]) }
  } catch {
    return null
  }
}

export function extractZhihuHotFromHtml(html: string, maxItems: number): RankingItem[] {
  const $ = load(html)
  const items: RankingItem[] = []
  const seen = new Set<string>()
  $('.HotList-item, .HotItem, [class*="HotList"]').find('a[href*="/question/"]').each((_, el) => {
    if (items.length >= maxItems) return
    let href = String($(el).attr('href') ?? '').trim()
    const title = normalizeWhitespace($(el).text() || $(el).attr('title') || '')
    if (!href || !title || title.length < 4) return
    try {
      href = href.startsWith('http') ? href : new URL(href, 'https://www.zhihu.com/').toString()
    } catch {
      return
    }
    if (seen.has(href)) return
    seen.add(href)
    items.push({ title, url: href })
  })
  if (items.length > 0) return items.slice(0, maxItems)
  $('a[href*="/question/"]').each((_, el) => {
    if (items.length >= maxItems) return
    let href = String($(el).attr('href') ?? '').trim()
    const title = normalizeWhitespace($(el).text() || $(el).attr('title') || '')
    if (!href || !title || title.length < 4) return
    try {
      href = href.startsWith('http') ? href : new URL(href, 'https://www.zhihu.com/').toString()
    } catch {
      return
    }
    if (seen.has(href)) return
    seen.add(href)
    items.push({ title, url: href })
  })
  return items.slice(0, maxItems)
}

export async function fetchToutiaoHot(userAgent: string | undefined, signal: AbortSignal) {
  const url = 'https://www.toutiao.com/api/pc/hot/hot_board/'
  const res = await fetch(url, {
    signal,
    redirect: 'follow',
    headers: {
      'user-agent': userAgent || '',
      referer: 'https://www.toutiao.com/'
    }
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Toutiao hot API failed: HTTP ${res.status}; body=${body.slice(0, 160)}`)
  }
  return (await res.json()) as any
}

export function extractToutiaoHotFromJson(payload: any, maxItems: number): RankingItem[] {
  const list = Array.isArray(payload?.data) ? payload.data : []
  const items: RankingItem[] = []
  for (const it of list) {
    const title = normalizeWhitespace(it?.Title || it?.title || it?.HotEvent?.Title || '')
    let url = String(it?.Url || it?.ShareUrl || it?.HotEvent?.Url || '').trim()
    if (!url && title) url = `https://so.toutiao.com/search?keyword=${encodeURIComponent(title)}`
    if (!title || !url) continue
    const item: RankingItem = { title, url }
    const hot = it?.HotValue || it?.HeatValue || it?.hot_value
    if (Number.isFinite(Number(hot))) (item as any).heat = Number(hot)
    items.push(item)
    if (items.length >= maxItems) break
  }
  return items
}

export function extractToutiaoHotFromHtml(html: string, maxItems: number): RankingItem[] {
  const items: RankingItem[] = []
  try {
    const m = html.match(/"hot_list"\s*:\s*(\[[\s\S]*?\])/)
    if (m) {
      const arr = JSON.parse(m[1])
      const list = Array.isArray(arr) ? arr : []
      for (const it of list) {
        const title = normalizeWhitespace(it?.Title || it?.title || '')
        let url = String(it?.ShareUrl || it?.Url || '').trim()
        if (!url && title) url = `https://so.toutiao.com/search?keyword=${encodeURIComponent(title)}`
        if (!title || !url) continue
        items.push({ title, url })
        if (items.length >= maxItems) break
      }
    }
  } catch {}
  if (items.length > 0) return items.slice(0, maxItems)
  try {
    const $ = load(html)
    $('a[href*="/search"]').each((_, el) => {
      if (items.length >= maxItems) return
      let href = String($(el).attr('href') || '').trim()
      const title = normalizeWhitespace($(el).text() || '')
      if (!title || !href) return
      try {
        href = href.startsWith('http') ? href : new URL(href, 'https://www.toutiao.com/').toString()
      } catch {}
      items.push({ title, url: href })
    })
  } catch {}
  return items.slice(0, maxItems)
}

export function extractWeiboHotFromHtml(html: string, maxItems: number): RankingItem[] {
  const $ = load(html)
  const items: RankingItem[] = []
  $('table tbody tr').each((_, tr) => {
    if (items.length >= maxItems) return
    const a = $(tr).find('td.td-02 a').first()
    const title = normalizeWhitespace(a.text())
    let href = String(a.attr('href') || '').trim()
    if (!title || !href) return
    try {
      href = href.startsWith('http') ? href : new URL(href, 'https://s.weibo.com/').toString()
    } catch {}
    const heatText = normalizeWhitespace($(tr).find('td.td-02 span').last().text())
    const heat = heatText ? Number(String(heatText).replace(/[^\d]/g, '')) : undefined
    const rankText = normalizeWhitespace($(tr).find('td.td-01.ranktop,td.td-01').text())
    const rank = rankText ? Number(String(rankText).replace(/[^\d]/g, '')) : undefined
    const it: RankingItem = { title, url: href }
    if (Number.isFinite(rank as any)) (it as any).rank = rank
    if (Number.isFinite(heat as any)) (it as any).heat = heat
    items.push(it)
  })
  return items.slice(0, maxItems)
}

export function extractDouyinHotFromHtml(html: string, maxItems: number): RankingItem[] {
  const $ = load(html)
  const items: RankingItem[] = []
  const seen = new Set<string>()
  $('a[href*="/hot/"], a[href*="modal_id="]').each((_, el) => {
    if (items.length >= maxItems) return
    let href = String($(el).attr('href') || '').trim()
    const title = normalizeWhitespace($(el).find('.title, .text, span').first().text() || $(el).text())
    if (!title || !href) return
    try {
      href = href.startsWith('http') ? href : new URL(href, 'https://www.douyin.com/').toString()
    } catch {
      return
    }
    if (seen.has(href)) return
    seen.add(href)
    items.push({ title, url: href })
  })
  return items.slice(0, maxItems)
}
