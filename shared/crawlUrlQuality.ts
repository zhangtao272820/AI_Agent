/**
 * 爬虫 URL 质量门禁：过滤搜索引擎结果页、门户导航等不可深抓 URL。
 * 参考 Crawlee/Firecrawl「SERP 摘要 + 选择性深抓」——种子必须是内容页，不能是搜索跳转链。
 */

export function normalizeCrawlUrlKey(url: string): string {
  try {
    const u = new URL(String(url ?? '').trim())
    u.hash = ''
    return u.toString().replace(/\/+$/, '')
  } catch {
    return String(url ?? '').trim().replace(/\/+$/, '')
  }
}

/** 搜索引擎 SERP / 热搜跳转 URL（非正文页） */
export function isSearchEngineResultUrl(url: string): boolean {
  const raw = String(url ?? '').trim()
  if (!/^https?:\/\//i.test(raw)) return false
  try {
    const u = new URL(raw)
    const host = u.hostname.toLowerCase().replace(/^www\./, '')
    const pathQuery = `${u.pathname}${u.search}`.toLowerCase()

    if (host === 'baidu.com' || host.endsWith('.baidu.com')) {
      if (/\/s(?:\/|$|\?)/i.test(u.pathname) || u.searchParams.has('wd') || u.searchParams.has('word')) return true
      if (pathQuery.includes('/sf/vsearch') || pathQuery.includes('/baidu.php')) return true
    }
    if (host.includes('google.') && (pathQuery.includes('/search') || u.searchParams.has('q'))) return true
    if (host.includes('bing.com') && /\/search/i.test(pathQuery)) return true
    if (host.includes('sogou.com') && (pathQuery.includes('/web') || u.searchParams.has('query'))) return true
    if (host.includes('so.com') && u.searchParams.has('q')) return true
    if (host.includes('duckduckgo.com') && pathQuery.includes('/?')) return true
    if (host.includes('yahoo.com') && pathQuery.includes('/search')) return true
    return false
  } catch {
    return false
  }
}

/** 门户首页 / 导航页（易误抽热搜、导航链） */
export function isPortalHomeUrl(url: string): boolean {
  const raw = String(url ?? '').trim()
  if (!/^https?:\/\//i.test(raw)) return false
  try {
    const u = new URL(raw)
    const host = u.hostname.toLowerCase()
    const path = u.pathname.replace(/\/+$/, '') || '/'
    if (path !== '/' && path !== '/index.html') return false
    const portals = ['baidu.com', 'sohu.com', '163.com', 'qq.com', 'sina.com.cn', 'ifeng.com']
    return portals.some((p) => host === p || host.endsWith(`.${p}`))
  } catch {
    return false
  }
}

/** 可作为 Manager seed / Extractor 深抓目标 */
export function isValidCrawlSeedUrl(url: string): boolean {
  const u = String(url ?? '').trim()
  if (!/^https?:\/\//i.test(u)) return false
  if (isSearchEngineResultUrl(u)) return false
  if (isPortalHomeUrl(u)) return false
  if (isLowValueTutorialSeedUrl(u)) return false
  if (/^about:blank#/i.test(u)) return false
  return true
}

/**
 * 开发教程 / 代码托管等「讲怎么爬」的页面，不是目标数据页。
 * 用于 SERP 种子过滤（URL 质量门禁，非用户意图关键词表）。
 */
export function isLowValueTutorialSeedUrl(url: string): boolean {
  const raw = String(url ?? '').trim()
  if (!/^https?:\/\//i.test(raw)) return false
  try {
    const u = new URL(raw)
    const host = u.hostname.toLowerCase().replace(/^www\./, '')
    const tutorialHosts = [
      'csdn.net',
      'jb51.net',
      'cnblogs.com',
      'jianshu.com',
      'juejin.cn',
      'segmentfault.com',
      'stackoverflow.com',
      'stackexchange.com',
      'blog.csdn.net',
      'cloud.tencent.com',
      'developer.aliyun.com',
      'oschina.net',
      '51cto.com',
      'imooc.com',
      'runoob.com',
      'w3school.com.cn',
    ]
    if (tutorialHosts.some((h) => host === h || host.endsWith(`.${h}`))) return true
    // GitHub issues/gist 等非目标榜单页
    if (host === 'github.com' || host.endsWith('.github.io')) return true
    return false
  } catch {
    return false
  }
}

export function filterCrawlSeedUrls(urls: string[], max = 12): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of urls) {
    const u = String(raw ?? '').trim()
    if (!isValidCrawlSeedUrl(u)) continue
    const key = normalizeCrawlUrlKey(u)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(u)
    if (out.length >= max) break
  }
  return out
}

export function filterCrawlOutputItems<T extends { url?: unknown }>(items: T[]): T[] {
  return items.filter((it) => {
    const url = String(it.url ?? '').trim()
    if (!url) return true
    if (!/^https?:\/\//i.test(url)) return false
    return !isSearchEngineResultUrl(url)
  })
}
