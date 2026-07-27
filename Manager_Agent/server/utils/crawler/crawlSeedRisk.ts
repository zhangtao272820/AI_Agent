/**
 * SERP 种子抓取风险分级：优先开放源，跳过高摩擦站点（文库/知网/付费墙等）。
 * 参考 Crawlee / Firecrawl 的「搜索摘要 + 选择性深抓」混合策略。
 */

/** 0=开放可抓，1=中等摩擦，2=高摩擦（宜仅用 SERP 摘要） */
export function crawlRiskScore(url: string): number {
  const u = String(url ?? '').trim().toLowerCase()
  if (!u) return 2
  let host = ''
  let path = ''
  try {
    const parsed = new URL(u)
    host = parsed.hostname.toLowerCase()
    path = parsed.pathname.toLowerCase()
  } catch {
    return 2
  }

  const highFrictionHosts = [
    'wenku.baidu.com',
    'wk.baidu.com',
    'xueshu.baidu.com',
    'cnki.net',
    'wanfangdata.com.cn',
    'doc88.com',
    'docin.com',
    'book118.com',
    'ishare.iask.sina.com.cn',
    'mbd.baidu.com',
    'tieba.baidu.com',
  ]
  if (highFrictionHosts.some((h) => host === h || host.endsWith(`.${h}`))) return 2

  const highFrictionPath = [
    /\/view\/[a-f0-9]+\.html/i.test(u) && host.includes('baidu.com'),
    host.includes('cnki') && /\/article\//i.test(path),
    host.includes('zhihu.com') && path.includes('/question/'),
  ]
  if (highFrictionPath.some(Boolean)) return 2

  const mediumHosts = ['zhihu.com', 'weibo.com', 'douyin.com', 'xiaohongshu.com', 'bilibili.com']
  if (mediumHosts.some((h) => host === h || host.endsWith(`.${h}`))) return 1

  const openHosts = ['gov.cn', 'edu.cn', 'org.cn', 'who.int', 'nih.gov', 'wikipedia.org', 'baike.baidu.com']
  if (openHosts.some((h) => host === h || host.endsWith(`.${h}`))) return 0

  return 1
}

export function isHighFrictionSeedUrl(url: string): boolean {
  return crawlRiskScore(url) >= 2
}

export type CrawlAction = 'crawl' | 'serp_only' | 'mcp'

/** 根据风险与是否有 SERP 摘要，决定 Manager 侧标注的抓取动作 */
export function crawlActionForUrl(url: string, hasSerpSnippet = true): CrawlAction {
  const risk = crawlRiskScore(url)
  if (risk >= 2) return hasSerpSnippet ? 'serp_only' : 'mcp'
  if (risk === 1) return 'crawl'
  return 'crawl'
}

/** 过滤出适合浏览器/云抓取的低风险种子（仅作 LLM 精抓优先级，不应从 seed_urls 硬删） */
export function filterLowRiskSeedUrls(urls: string[], max = 6): string[] {
  const ranked = [...urls]
    .map((u) => String(u ?? '').trim())
    .filter((u) => /^https?:\/\//i.test(u))
    .sort((a, b) => crawlRiskScore(a) - crawlRiskScore(b))
  const out: string[] = []
  for (const u of ranked) {
    if (crawlRiskScore(u) >= 2) continue
    if (!out.includes(u)) out.push(u)
    if (out.length >= max) break
  }
  return out
}
