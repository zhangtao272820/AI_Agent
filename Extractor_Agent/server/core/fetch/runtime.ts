import { load } from 'cheerio'
import { chromium, type Browser, type Response } from 'playwright'

import { rewriteSearchSerpSeedToCnBing, safeHost } from '../../services/crawlerAgentTaskUtils'

export type RobotsPolicy = {
  allows: (targetUrl: string) => boolean
  crawlDelayMs: number
}

export type FetchSnapshot = {
  url: string
  finalUrl: string
  title: string
  html: string
  networkJson: any[]
}

type RetryFetchOptions = {
  timeoutMs?: number
  maxAttempts?: number
  baseBackoffMs?: number
}

type ProxyLike = { server: string; username?: string; password?: string }
type ProxyPoolLike = { getNext: () => Promise<ProxyLike | null>; markBad: (proxy: ProxyLike) => void }

function normalizeWhitespace(text: string) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

function clipStr(s: string, n: number) {
  return s.length > n ? s.slice(0, n) : s
}

function nowTs() {
  return Date.now()
}

function sleep(ms: number, signal?: AbortSignal) {
  const t = Math.max(0, Math.floor(ms))
  if (!t) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      resolve()
    }, t)
    const onAbort = () => {
      cleanup()
      reject(new Error('aborted'))
    }
    const cleanup = () => {
      clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', onAbort)
    }
    if (signal?.aborted) return onAbort()
    if (signal) signal.addEventListener('abort', onAbort, { once: true })
  })
}

function randInt(min: number, max: number) {
  const a = Number.isFinite(min) ? min : 0
  const b = Number.isFinite(max) ? max : 0
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  if (hi <= lo) return Math.floor(lo)
  return Math.floor(lo + Math.random() * (hi - lo + 1))
}

async function humanScroll(page: any) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0
      const distance = 200
      let noChangeCount = 0
      const timer = setInterval(() => {
        // @ts-ignore
        const scrollHeight = document.body.scrollHeight
        // @ts-ignore
        window.scrollBy(0, distance)
        totalHeight += distance
        if (totalHeight >= scrollHeight) {
          noChangeCount++
        } else {
          noChangeCount = 0
        }
        if (noChangeCount >= 3 || totalHeight > 10000) {
          clearInterval(timer)
          resolve(null)
        }
      }, 200)
    })
  })
}

async function simulateHumanBehavior(page: any, signal: AbortSignal) {
  await sleep(randInt(1000, 5000), signal)
  try {
    const vp = page.viewportSize() ?? { width: 1280, height: 800 }
    await page.mouse.move(randInt(10, vp.width - 10), randInt(10, vp.height - 10), { steps: randInt(5, 25) })
  } catch {}
  if (Math.random() < 0.85) {
    await humanScroll(page)
  }
  if (Math.random() < 0.6) {
    try {
      await page.mouse.wheel(0, randInt(300, 1500))
    } catch {}
  }
  await sleep(randInt(1000, 5000), signal)
}

function stealthInitScript() {
  const script = `
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = { runtime: {} };
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'] });
  `
  return script
}

import { loadSessionForHost, saveSessionForHost } from '../../utils/crawl_session_store'
import { classifyFailReason, isHttpBlockedError } from '../../utils/crawl_failure_tags'
import { canInvokeMcp, markMcpCallUsed } from './mcpBudget'
import { parseSerpHitsFromOptions, shouldFailFastToSerp } from '../../utils/serp_hybrid'

function pushRunEvent(stats: any, evt: any, options?: any) {
  if (!stats || typeof stats !== 'object') return
  if (!Array.isArray((stats as any)._events)) (stats as any)._events = []
  const arr = (stats as any)._events as any[]
  arr.push(evt)
  if (arr.length > 200) arr.splice(0, arr.length - 200)
  if (options && typeof options === 'object') {
    if (!Array.isArray((options as any).__channelTrace)) (options as any).__channelTrace = []
    ;(options as any).__channelTrace.push({ ...evt, at: new Date().toISOString() })
    if ((options as any).__channelTrace.length > 200) {
      ;(options as any).__channelTrace.splice(0, (options as any).__channelTrace.length - 200)
    }
  }
}

export function isCloudScrapeConfigured(config: any): boolean {
  return Boolean(String(config?.mcp?.provider ?? '').trim())
}

async function tryCloudScrapeFallback(
  url: string,
  config: any,
  signal: AbortSignal,
  emitLog: (level: 'info' | 'warn' | 'error', message: string) => void,
  runStats: any,
  options: any,
  tStart: number,
  cloudPermanentlyDisabled: boolean,
): Promise<FetchSnapshot | null> {
  if (cloudPermanentlyDisabled || !config?.mcp?.provider) return null
  if (!canInvokeMcp(options)) {
    emitLog('warn', 'Worker：云抓取额度已用尽，跳过 MCP 调用')
    return null
  }
  markMcpCallUsed(options)
  const mcpSnap = await fetchViaMcp(url, config, signal, emitLog)
  if (mcpSnap) {
    pushRunEvent(runStats, { ts: nowTs(), host: safeHost(url), url, channel: 'mcp', status: 'ok', ms: Date.now() - tStart }, options)
    return mcpSnap
  }
  return null
}

async function fetchViaMcpBudgeted(
  url: string,
  config: any,
  signal: AbortSignal,
  options: any,
  emitLog: (level: 'info' | 'warn' | 'error', message: string) => void,
): Promise<FetchSnapshot | null> {
  if (!canInvokeMcp(options)) {
    emitLog('warn', 'Worker：云抓取额度已用尽，跳过 MCP 调用')
    return null
  }
  markMcpCallUsed(options)
  return fetchViaMcp(url, config, signal, emitLog)
}

function buildTimeoutSignal(parentSignal: AbortSignal, timeoutMs: number) {
  const timeoutCtrl = new AbortController()
  const merged = new AbortController()
  const cleanupHandlers: Array<() => void> = []
  const timer = setTimeout(() => timeoutCtrl.abort(new Error('request_timeout')), timeoutMs)
  const abortMerged = () => {
    if (!merged.signal.aborted) {
      merged.abort(parentSignal.aborted ? parentSignal.reason : timeoutCtrl.signal.reason)
    }
  }
  const onParentAbort = () => abortMerged()
  const onTimeoutAbort = () => abortMerged()
  parentSignal.addEventListener('abort', onParentAbort)
  timeoutCtrl.signal.addEventListener('abort', onTimeoutAbort)
  cleanupHandlers.push(() => clearTimeout(timer))
  cleanupHandlers.push(() => parentSignal.removeEventListener('abort', onParentAbort))
  cleanupHandlers.push(() => timeoutCtrl.signal.removeEventListener('abort', onTimeoutAbort))
  return {
    signal: merged.signal,
    cleanup: () => cleanupHandlers.forEach((fn) => fn())
  }
}

export async function fetchWithRetry(
  input: string,
  init: RequestInit,
  parentSignal: AbortSignal,
  options?: RetryFetchOptions
): Promise<Response> {
  const timeoutMs = Number.isFinite(Number(options?.timeoutMs)) ? Math.max(1000, Math.floor(Number(options?.timeoutMs))) : 15_000
  const maxAttempts = Number.isFinite(Number(options?.maxAttempts)) ? Math.max(1, Math.floor(Number(options?.maxAttempts))) : 2
  const baseBackoffMs = Number.isFinite(Number(options?.baseBackoffMs)) ? Math.max(100, Math.floor(Number(options?.baseBackoffMs))) : 600
  let lastErr: unknown = null
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { signal, cleanup } = buildTimeoutSignal(parentSignal, timeoutMs)
    try {
      const res = await fetch(input, { ...init, signal })
      if (res.status === 429 || res.status >= 500) {
        if (attempt < maxAttempts) {
          const waitMs = baseBackoffMs * Math.pow(2, attempt - 1)
          await sleep(waitMs, parentSignal)
          continue
        }
      }
      return res as any
    } catch (e) {
      lastErr = e
      const msg = String((e as any)?.message ?? e ?? '')
      const retryable = /timeout|aborted|ECONNRESET|ENOTFOUND|EAI_AGAIN|fetch failed/i.test(msg)
      if (attempt >= maxAttempts || !retryable) throw e
      const waitMs = baseBackoffMs * Math.pow(2, attempt - 1)
      await sleep(waitMs, parentSignal)
    } finally {
      cleanup()
    }
  }
  throw lastErr || new Error('fetch_with_retry_failed')
}

function parseRobotsTxt(text: string, ua: string): RobotsPolicy {
  const lines = String(text || '').split(/\\r?\\n/)
  const groups: Array<{ uas: string[]; allows: string[]; disallows: string[]; crawlDelaySec: number | null }> = []
  let current: { uas: string[]; allows: string[]; disallows: string[]; crawlDelaySec: number | null } | null = null
  for (const raw of lines) {
    const clean = raw.replace(/#.*$/, '').trim()
    if (!clean) continue
    const idx = clean.indexOf(':')
    if (idx <= 0) continue
    const key = clean.slice(0, idx).trim().toLowerCase()
    const value = clean.slice(idx + 1).trim()
    if (key === 'user-agent') {
      if (!current || (current.uas.length > 0 && (current.allows.length > 0 || current.disallows.length > 0 || current.crawlDelaySec !== null))) {
        current = { uas: [], allows: [], disallows: [], crawlDelaySec: null }
        groups.push(current)
      }
      current.uas.push(value.toLowerCase())
      continue
    }
    if (!current) continue
    if (key === 'allow') current.allows.push(value || '/')
    else if (key === 'disallow') current.disallows.push(value)
    else if (key === 'crawl-delay') {
      const sec = Number(value)
      if (Number.isFinite(sec) && sec >= 0) current.crawlDelaySec = sec
    }
  }

  const uaNorm = String(ua || '').toLowerCase()
  const pickGroup = () => {
    let best: typeof groups[number] | null = null
    let bestLen = -1
    for (const g of groups) {
      for (const token of g.uas) {
        if (token === '*') {
          if (bestLen < 0) {
            best = g
            bestLen = 0
          }
          continue
        }
        if (uaNorm.includes(token) && token.length > bestLen) {
          best = g
          bestLen = token.length
        }
      }
    }
    return best
  }

  const group = pickGroup()
  const allows = group?.allows ?? []
  const disallows = group?.disallows ?? []
  const crawlDelayMs = Math.max(0, Math.floor(Number(group?.crawlDelaySec ?? 0) * 1000))
  const isMatch = (pathWithQuery: string, rulePath: string) => {
    if (!rulePath) return false
    return pathWithQuery.startsWith(rulePath)
  }
  return {
    crawlDelayMs,
    allows: (targetUrl: string) => {
      let p = '/'
      try {
        const u = new URL(targetUrl)
        p = `${u.pathname || '/'}${u.search || ''}`
      } catch {}
      let bestAllowLen = -1
      let bestDisallowLen = -1
      for (const a of allows) {
        if (isMatch(p, a)) bestAllowLen = Math.max(bestAllowLen, a.length)
      }
      for (const d of disallows) {
        if (!d) continue
        if (isMatch(p, d)) bestDisallowLen = Math.max(bestDisallowLen, d.length)
      }
      if (bestDisallowLen < 0) return true
      return bestAllowLen >= bestDisallowLen
    }
  }
}

function pickUserAgent(config: any, taskPlan?: { targetSite?: string }) {
  const explicit = String(config?.crawler?.userAgent ?? '').trim()
  if (explicit) return explicit
  if (taskPlan?.targetSite === 'jd' && Math.random() < 0.5) {
    return 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
  }
  const base = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edg/125.0.0.0 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
  ]
  // 简单随机，保持与原实现一致的“可变 UA”效果
  const chosen = base[Math.floor(Math.random() * base.length)]
  return chosen || base[0]
}

export async function fetchRobotsPolicy(url: string, config: any, signal: AbortSignal): Promise<RobotsPolicy | null> {
  let origin = ''
  try {
    origin = new URL(url).origin
  } catch {
    return null
  }
  if (!origin) return null
  const robotsUrl = `${origin}/robots.txt`
  const res = await fetchWithRetry(
    robotsUrl,
    {
      headers: {
        'user-agent': pickUserAgent(config),
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.7'
      },
      redirect: 'follow'
    },
    signal,
    { timeoutMs: 8000, maxAttempts: 1, baseBackoffMs: 300 }
  ).catch(() => null)
  if (!res || !res.ok) return null
  const text = await (res as any).text().catch(() => '')
  if (!text) return null
  return parseRobotsTxt(text, pickUserAgent(config))
}

let globalBrowser: Browser | null = null
let globalBrowserHeadless: boolean | null = null

function isBrowserRuntimeUnavailable(msg: string): boolean {
  const m = String(msg || '').toLowerCase()
  return (
    /executable doesn't exist|playwright install|browsertype\.launch/i.test(m) ||
    /libnss3\.so|libnspr4|libatk|libgbm|libx11|libasound|shared libraries|shared object file/i.test(m) ||
    /exitcode=127|exit code 127|no such file or directory/i.test(m) ||
    /browser has been closed|target page, context or browser has been closed|page has been closed|context has been closed/i.test(m)
  )
}

function resolveChromiumExecutablePath(): string | undefined {
  const fromEnv = String(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? '').trim()
  return fromEnv || undefined
}

async function getBrowser(headless: boolean) {
  if (!globalBrowser) {
    globalBrowserHeadless = headless
    const executablePath = resolveChromiumExecutablePath()
    try {
      globalBrowser = await chromium.launch({
        ...(executablePath ? { executablePath } : {}),
        headless,
        ignoreDefaultArgs: ['--enable-automation'],
        args: [
          '--disable-blink-features=AutomationControlled',
          '--disable-dev-shm-usage',
          '--no-default-browser-check',
          '--disable-features=IsolateOrigins,site-per-process'
        ]
      })
    } catch (e: any) {
      globalBrowser = null
      globalBrowserHeadless = null
      throw e
    }
  } else if (globalBrowserHeadless !== headless) {
    try {
      await globalBrowser.close()
    } catch {}
    globalBrowser = null
    globalBrowserHeadless = null
    return await getBrowser(headless)
  }
  return globalBrowser
}

export async function ensureBrowser(headless: boolean) {
  return await getBrowser(Boolean(headless))
}

export async function fetchHtml(url: string, config: any, signal: AbortSignal, _session?: any) {
  const ua = String(config?.crawler?.userAgent ?? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36').trim()
  const origin = (() => {
    try {
      return new URL(url).origin
    } catch {
      return ''
    }
  })()
  const referer = (() => {
    if (/douban\.com/i.test(url)) return 'https://movie.douban.com/'
    return origin ? `${origin}/` : ''
  })()
  const headers: Record<string, string> = {
    'user-agent': ua,
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.7',
    referer
  }
  const res = await fetchWithRetry(
    url,
    { headers, redirect: 'follow' },
    signal,
    { timeoutMs: 15_000, maxAttempts: 2, baseBackoffMs: 600 }
  )
  if (!(res as any).ok) {
    let body = ''
    try {
      body = await (res as any).text()
    } catch {}
    const hint = body ? `; body=${clipStr(body.replace(/\s+/g, ' ').trim(), 160)}` : ''
    throw new Error(`HTTP ${(res as any).status} ${(res as any).statusText}; url=${url}${hint}`)
  }
  const contentType = String((res as any).headers?.get?.('content-type') ?? '')
  const charsetFromHeader = (() => {
    const m = contentType.match(/charset\s*=\s*([^;]+)/i)
    return m ? String(m[1] ?? '').trim().toLowerCase() : ''
  })()
  const buf = await (res as any).arrayBuffer()
  const pickEncoding = () => {
    const c = charsetFromHeader
    if (c.includes('gbk') || c.includes('gb2312') || c.includes('gb18030')) return 'gbk'
    if (c) return c
    try {
      const sniff = new TextDecoder('utf-8').decode(buf.slice(0, Math.min(4096, buf.byteLength)))
      const m1 = sniff.match(/<meta[^>]+charset\s*=\s*["']?\s*([a-z0-9_-]+)\s*["']?/i)
      const m2 = sniff.match(/<meta[^>]+content\s*=\s*["'][^"']*charset=([a-z0-9_-]+)[^"']*["']/i)
      const cs = String((m1?.[1] ?? m2?.[1] ?? '')).trim().toLowerCase()
      if (cs.includes('gbk') || cs.includes('gb2312') || cs.includes('gb18030')) return 'gbk'
      if (cs) return cs
    } catch {}
    return 'utf-8'
  }
  const enc = pickEncoding()
  try {
    return new TextDecoder(enc as any).decode(buf)
  } catch {
    return new TextDecoder('utf-8').decode(buf)
  }
}

export async function fetchViaMcp(url: string, config: any, signal: AbortSignal, emitLog?: (l: any, m: string) => void): Promise<FetchSnapshot | null> {
  const provider = String(config?.mcp?.provider ?? '').trim().toLowerCase()
  const apiKey = String(config?.mcp?.apiKey ?? '').trim()
  const baseUrl = String(config?.mcp?.baseUrl ?? '').trim()
  const qp = String(config?.mcp?.queryParamKey ?? 'apikey').trim()
  const hk = String(config?.mcp?.headerKey ?? '').trim()
  const render = Boolean(config?.mcp?.render)
  if (!provider) return null

  if (emitLog) emitLog('info', `Worker：云抓取 (${provider}) 正在抓取 ${url} ...`)

  const build = (u: string) => {
    if (provider === 'scrapingant') {
      const endpoint = baseUrl || 'https://api.scrapingant.com/v2/general'
      const q = new URL(endpoint)
      q.searchParams.set('url', u)
      if (render) q.searchParams.set('js_snippet', '')
      const headers: Record<string, string> = {}
      if (apiKey) headers['x-api-key'] = apiKey
      return { url: q.toString(), headers }
    }
    if (provider === 'zenrows') {
      const endpoint = baseUrl || 'https://api.zenrows.com/v1/'
      const q = new URL(endpoint)
      q.searchParams.set('url', u)
      if (apiKey) q.searchParams.set('apikey', apiKey)
      if (render) q.searchParams.set('js_render', 'true')
      return { url: q.toString(), headers: {} as Record<string, string> }
    }
    if (provider === 'scraperapi') {
      const endpoint = baseUrl || 'https://api.scraperapi.com/'
      const q = new URL(endpoint)
      if (apiKey) q.searchParams.set('api_key', apiKey)
      q.searchParams.set('url', u)
      if (render) q.searchParams.set('render', 'true')
      return { url: q.toString(), headers: {} as Record<string, string> }
    }
    if (provider === 'bailian') {
      const endpoint = baseUrl || 'https://dashscope.aliyuncs.com/api/v1/services/aigc/tools/crawler'
      const headers: Record<string, string> = {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
      return {
        url: endpoint,
        headers,
        method: 'POST',
        body: JSON.stringify({
          model: 'qwen3.5-flash',
          input: { url: u },
          parameters: { render: render }
        })
      }
    }
    if (provider === 'firecrawl') {
      const endpoint = baseUrl || 'https://api.firecrawl.dev/v1/scrape'
      const headers: Record<string, string> = {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
      return {
        url: endpoint,
        headers,
        method: 'POST',
        body: JSON.stringify({
          url: u,
          formats: ['html', 'markdown'],
          waitFor: /zhihu\.com\/hot/i.test(u) ? Math.max(render ? 3000 : 0, 8000) : render ? 3000 : 0,
          ...(String(config?.mcp?.country ?? '').trim()
            ? { location: { country: String(config.mcp.country).trim() } }
            : {}),
        })
      }
    }
    if (provider === 'generic') {
      if (!baseUrl) return null
      let final = baseUrl.replace('{url}', encodeURIComponent(u)).replace('{apiKey}', encodeURIComponent(apiKey))
      const headers: Record<string, string> = {}
      if (hk && apiKey) headers[hk] = apiKey
      if (qp && apiKey && !final.includes(`${qp}=`)) {
        const j = final.includes('?') ? '&' : '?'
        final = `${final}${j}${encodeURIComponent(qp)}=${encodeURIComponent(apiKey)}`
      }
      return { url: final, headers }
    }
    return null
  }
  const req = build(url)
  if (!req || !req.url) return null
  const res = await fetchWithRetry(
    req.url,
    {
      method: (req as any).method || 'GET',
      body: (req as any).body,
      headers: {
        ...(req.headers || {}),
        'user-agent': pickUserAgent(config),
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.7'
      },
      redirect: 'follow'
    },
    signal,
    // Firecrawl 常卡教程站：单次超时收紧，最多 1 次重试，避免单 URL 堵 60s+
    {
      timeoutMs: provider === 'firecrawl' ? 12_000 : 20_000,
      maxAttempts: provider === 'firecrawl' ? 1 : 2,
      baseBackoffMs: 800
    }
  )
  if (!(res as any).ok) {
    const errText = await (res as any).text().catch(() => '')
    if (emitLog) emitLog('warn', `Worker：云抓取 (${provider}) 调用失败：HTTP ${(res as any).status} ${errText.slice(0, 100)}`)
    return null
  }
  let html = ''
  if (provider === 'bailian') {
    const payload = await (res as any).json().catch(() => null) as any
    html = payload?.output?.result || payload?.output?.text || ''
    if (!html && payload) html = JSON.stringify(payload)
  } else if (provider === 'firecrawl') {
    const payload = await (res as any).json().catch(() => null) as any
    html = payload?.data?.html || payload?.html || ''
    const md = String(payload?.data?.markdown || payload?.markdown || '').trim()
    if (md && (!html || html.length < 500)) {
      html = `<article>${md.replace(/\n/g, '<br>')}</article>`
    }
    if (!html && payload) html = JSON.stringify(payload)
  } else {
    html = await (res as any).text().catch(() => '')
  }
  if (!html) {
    if (emitLog) emitLog('warn', `Worker：云抓取 (${provider}) 返回内容为空`)
    return null
  }
  const title = extractTitleFromHtml(html)
  if (looksLikeCaptchaOrBlock(title, html)) {
    if (emitLog) emitLog('warn', `Worker：云抓取 (${provider}) 返回拦截页/验证码页`)
    return null
  }

  if (emitLog) emitLog('info', `Worker：云抓取 (${provider}) 成功`)
  return { url, finalUrl: url, title, html, networkJson: [] }
}

/** @deprecated 请使用 fetchViaCloudScrape；保留别名兼容旧引用 */
export const fetchViaCloudScrape = fetchViaMcp

export function looksLikeCaptchaOrBlock(title: string, html: string) {
  const t = normalizeWhitespace(title).toLowerCase()
  const h = normalizeWhitespace(html).toLowerCase()
  if (t.includes('just a moment') || t.includes('attention required')) return true
  if (/验证码|安全验证|人机验证|访问受限|安全检查/.test(title)) return true
  if (/(captcha|cloudflare|cf-ray|verify you are human|bot detection|access denied)/i.test(t)) return true
  if (/(captcha|verify|challenge|recaptcha|hcaptcha)/i.test(h)) return true
  if (/请完成安全验证|检测到异常请求|您的访问过于频繁|抱歉，您访问的内容不存在/.test(html)) return true
  if (/unusual traffic from your computer network|sorry we can't complete your request|before you continue to google/i.test(h)) return true
  return false
}

export function extractTitleFromHtml(html: string) {
  try {
    const $ = load(html)
    return normalizeWhitespace($('title').first().text())
  } catch {
    return ''
  }
}

export async function workerExecute(
  url: string,
  config: any,
  options: any,
  signal: AbortSignal,
  session: any,
  proxyPool: ProxyPoolLike | null,
  emitLog: (level: 'info' | 'warn' | 'error', message: string) => void,
  fastPath: boolean = false,
  task?: string
): Promise<FetchSnapshot> {
  url = rewriteSearchSerpSeedToCnBing(String(url ?? '').trim())
  const serpHits = parseSerpHitsFromOptions(options)
  const hybridSerpBypass = (errMsg?: string) => {
    if (shouldFailFastToSerp(url, serpHits, options, errMsg)) {
      throw new Error('captcha_or_block_page')
    }
  }
  const maxAttempts = shouldFailFastToSerp(url, serpHits, options) ? 1 : 3
  const headless = options.headless ?? true
  const delayMinMs = Number.isFinite(Number(options.delayMinMs)) ? Math.max(0, Math.floor(Number(options.delayMinMs))) : 1000
  const delayMaxMs = Number.isFinite(Number(options.delayMaxMs)) ? Math.max(0, Math.floor(Number(options.delayMaxMs))) : 5000
  const attemptDelay = () => sleep(randInt(delayMinMs, delayMaxMs), signal)
  const shortErr = (msg: string) => normalizeWhitespace(msg).slice(0, 160)
  let mcpFailedPermanently = false
  if (!(options as any).__runStats) (options as any).__runStats = { _events: [] }
  const runStats: any = (options as any).__runStats

  const preferMcp = Boolean((options as any).__preferMcp) && Boolean(config?.mcp?.provider)
  let useFastPath = fastPath
  if (preferMcp) {
    const tMcp = Date.now()
    emitLog('info', `Worker：云抓取优先通道 ${url}`)
    const mcpSnap = await fetchViaMcpBudgeted(url, config, signal, options, emitLog)
    if (mcpSnap) {
      pushRunEvent(runStats, { ts: nowTs(), host: safeHost(url), url, channel: 'mcp', status: 'ok', ms: Date.now() - tMcp }, options)
      return mcpSnap
    }
    mcpFailedPermanently = true
    hybridSerpBypass('captcha_or_block_page')
    useFastPath = false
    emitLog('warn', `Worker：云抓取未命中，切换浏览器兜底（跳过 HTTP 直连）：${url}`)
  }

  if (useFastPath) {
    const tStart = Date.now()
    emitLog('info', `Worker：尝试快速路径抓取 ${url}`)

    const taskPlan = (options as any)?.__taskPlan as { targetSite?: string } | undefined
    const jd = taskPlan?.targetSite === 'jd'
    if (jd && config?.mcp?.provider) {
      const mcpSnap = await fetchViaMcpBudgeted(url, config, signal, options, emitLog)
      if (mcpSnap) return mcpSnap
      mcpFailedPermanently = true
      emitLog('warn', `Worker：京东任务云抓取首次失败，本次 URL 不再重复调用以节省额度`)
    }

    try {
      const html = await fetchHtml(url, config, signal, session ?? undefined)
      const title = extractTitleFromHtml(html)
      if (!looksLikeCaptchaOrBlock(title, html)) {
        pushRunEvent(runStats, { ts: nowTs(), host: safeHost(url), url, channel: 'http', status: 'ok', ms: Date.now() - tStart }, options)
        return { url, finalUrl: url, title, html, networkJson: [] }
      }
      const fb = await tryCloudScrapeFallback(url, config, signal, emitLog, runStats, options, tStart, mcpFailedPermanently)
      if (fb) return fb
      mcpFailedPermanently = true
      hybridSerpBypass('captcha_or_block_page')
      emitLog('warn', `Worker：快速路径云抓取失败，本次 URL 不再重复云抓取`)
    } catch (e: any) {
      const msg = typeof e?.message === 'string' ? e.message : String(e)
      const shouldFallback = isHttpBlockedError(msg)

      if (!mcpFailedPermanently && config?.mcp?.provider) {
        const fb = await tryCloudScrapeFallback(url, config, signal, emitLog, runStats, options, Date.now(), mcpFailedPermanently)
        if (fb) return fb
        mcpFailedPermanently = true
        emitLog('warn', `Worker：异常路径云抓取失败，本次 URL 不再重复云抓取`)
      }

      if (!shouldFallback) throw e
      pushRunEvent(runStats, { ts: nowTs(), host: safeHost(url), url, channel: 'http', status: 'error', reason: classifyFailReason(msg), ms: Date.now() - tStart }, options)
      emitLog('warn', `Worker：直连抓取被拦截，切换浏览器模式：${url}`)
    }
  }

  let lastErr: any = null
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt === 2 && !mcpFailedPermanently) {
      const fb = await tryCloudScrapeFallback(url, config, signal, emitLog, runStats, options, Date.now(), mcpFailedPermanently)
      if (fb) {
        emitLog('info', `Worker：浏览器失败后云抓取兜底成功 ${url}`)
        return fb
      }
      mcpFailedPermanently = true
      emitLog('warn', `Worker：浏览器兜底云抓取失败，本次 URL 不再重复调用`)
    }
    const proxy = proxyPool ? await proxyPool.getNext() : null
    const ua = pickUserAgent(config, (options as any)?.__taskPlan)
    const tStart = Date.now()
    let browser: Browser
    try {
      browser = await getBrowser(headless)
    } catch (e: any) {
      const msg = String(e?.message || e || '')
      if (!isBrowserRuntimeUnavailable(msg)) throw e
      emitLog('warn', 'Worker：浏览器未就绪，回退 HTTP/云抓取')
      const fb = await tryCloudScrapeFallback(url, config, signal, emitLog, runStats, options, tStart, false)
      if (fb) return fb
      const html = await fetchHtml(url, config, signal, session ?? undefined)
      const title = extractTitleFromHtml(html)
      pushRunEvent(runStats, { ts: nowTs(), host: safeHost(url), url, channel: 'http', status: 'ok', ms: Date.now() - tStart }, options)
      return { url, finalUrl: url, title, html, networkJson: [] }
    }
    const context = await browser.newContext({
      userAgent: ua,
      viewport: ua.includes('iPhone') ? { width: 375, height: 667 } : { width: 1366, height: 768 },
      javaScriptEnabled: true,
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
      deviceScaleFactor: ua.includes('iPhone') ? 2 : 1,
      hasTouch: ua.includes('iPhone'),
      proxy: proxy
        ? {
            server: proxy.server,
            username: proxy.username,
            password: proxy.password
          }
        : undefined,
      extraHTTPHeaders: {
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.7'
      }
    })

    await context.addInitScript(stealthInitScript())

    if (session?.cookies) {
      await context.addCookies(session.cookies)
    }

    const page = await context.newPage()
    let onAbort: any = null
    let onResponse: any = null
    try {
      const networkJson: any[] = []
      let capturedCount = 0
      let capturedChars = 0
      const maxCaptured = 20
      const maxChars = 800_000

      onResponse = async (resp: Response) => {
        try {
          if (capturedCount >= maxCaptured) return
          if (capturedChars >= maxChars) return
          const req = resp.request()
          const rt = req.resourceType()
          if (rt !== 'xhr' && rt !== 'fetch') return
          const headers = resp.headers()
          const ct = String((headers as any)['content-type'] ?? '').toLowerCase()
          const respUrl = resp.url()
          const looksJson = ct.includes('application/json') || /[?&]format=json\b/i.test(respUrl) || /\.json(\?|$)/i.test(respUrl)
          if (!looksJson) return

          const text = await resp.text()
          if (!text) return
          if (text.length > 200_000) return
          const trimmed = text.trim()
          if (!trimmed) return
          const parsed = JSON.parse(trimmed)
          networkJson.push({ url: respUrl, data: parsed })
          capturedCount++
          capturedChars += text.length
        } catch {}
      }

      onAbort = () => page.close().catch(() => {})
      signal.addEventListener('abort', onAbort)
      page.on('response', onResponse)

      await attemptDelay()
      if (attempt === 1) emitLog('info', `Worker：打开页面 ${url}`)

      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 })
      const status = resp?.status()
      if (status === 403 || status === 429) {
        throw new Error(`HTTP ${status} blocked`)
      }

      if (/zhihu\.com\/hot/i.test(url)) {
        await page
          .waitForResponse((r) => /hot-lists/i.test(r.url()) && r.status() === 200, { timeout: 20_000 })
          .catch(() => {})
        await sleep(1200, signal)
      }

      // 某些站点在页面稳定后再做随机移动/滚动，能模拟用户；如果这一步导致异常，直接忽略，不影响抓取结果。
      await simulateHumanBehavior(page, signal).catch(() => {})

      const title = await page.title().catch(() => '')
      const html = await page.content()
      const finalUrl = page.url()

      if (looksLikeCaptchaOrBlock(title, html)) {
        hybridSerpBypass('captcha_or_block_page')
        throw new Error('captcha_or_block_page')
      }

      try {
        const cookies = await context.cookies()
        const host = safeHost(finalUrl || url)
        if (host && cookies.length) saveSessionForHost(host, cookies as any)
      } catch {}

      pushRunEvent(runStats, { ts: nowTs(), host: safeHost(url), url, channel: 'browser', status: 'ok', ms: Date.now() - tStart }, options)
      return { url, finalUrl, title: normalizeWhitespace(title), html, networkJson }
    } catch (e: any) {
      lastErr = e
      const msg = typeof e?.message === 'string' ? e.message : String(e)
      pushRunEvent(runStats, { ts: nowTs(), host: safeHost(url), url, channel: 'browser', status: 'error', reason: classifyFailReason(msg), ms: Date.now() - tStart }, options)
      const retryable =
        isHttpBlockedError(msg) ||
        /captcha_or_block_page/i.test(msg) ||
        /net::err_|timeout/i.test(msg)

      if (proxy) proxyPool?.markBad(proxy)

      if (shouldFailFastToSerp(url, serpHits, options, msg)) {
        throw new Error('captcha_or_block_page')
      }

      if (!retryable || attempt >= maxAttempts) {
        if (msg.includes('closed') || msg.includes('Navigation interrupted')) {
          throw new Error('Task canceled by user')
        }
        if (!mcpFailedPermanently && config?.mcp?.provider && isHttpBlockedError(msg)) {
          const mcpSnap = await fetchViaMcpBudgeted(url, config, signal, options, emitLog)
          if (mcpSnap) {
            emitLog('info', `Worker：浏览器模式失败后 MCP 兜底成功 ${url}`)
            return mcpSnap
          }
          mcpFailedPermanently = true
        }
        emitLog('error', `Worker：页面抓取失败：${url}；原因=${shortErr(msg)}`)
        throw e
      }

      if (/zhihu\.com\/hot/i.test(url) && isHttpBlockedError(msg)) {
        emitLog('warn', 'Worker：知乎热榜浏览器受阻，不再重复浏览器重试')
        if (!mcpFailedPermanently && config?.mcp?.provider) {
          const mcpSnap = await fetchViaMcpBudgeted(url, config, signal, options, emitLog)
          if (mcpSnap) {
            emitLog('info', `Worker：知乎热榜 MCP 兜底成功 ${url}`)
            return mcpSnap
          }
          mcpFailedPermanently = true
        }
        emitLog('error', `Worker：页面抓取失败：${url}；原因=${shortErr(msg)}`)
        throw e
      }

      emitLog('warn', `Worker：抓取受阻，重试 ${attempt + 1}/${maxAttempts}；原因=${shortErr(msg)}`)
      await attemptDelay()
    } finally {
      try {
        if (onAbort) signal.removeEventListener('abort', onAbort)
      } catch {}
      try {
        if (onResponse) page.off('response', onResponse)
      } catch {}
      try {
        await page.close()
      } catch {}
      try {
        await context.close()
      } catch {}
    }
  }
  throw lastErr || new Error('unknown_worker_error')
}

