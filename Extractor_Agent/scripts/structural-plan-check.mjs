/**
 * 结构性 Plan 门禁（无 LLM、无网络）：验证「知乎热榜前三」等典型任务不被误判。
 */

function parseChineseNumber(raw) {
  const t = String(raw ?? '').trim()
  if (!t) return NaN
  const d = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
  if (/^\d+$/.test(t)) return Number.parseInt(t, 10)
  if (t === '十') return 10
  if (t.startsWith('十')) return 10 + (d[t[1]] ?? 0)
  if (t.endsWith('十')) return (d[t[0]] ?? 0) * 10
  if (t.includes('十')) {
    const [a, b] = t.split('十')
    const av = d[a] ?? (a ? Number.parseInt(a, 10) : 0)
    const bv = d[b] ?? (b ? Number.parseInt(b, 10) : 0)
    return (av || 0) * 10 + (bv || 0)
  }
  return d[t] ?? NaN
}

const SITE_RULES = [
  { site: 'zhihu', keywords: /知乎|zhihu/i, exclude: /微博|weibo|豆瓣|bilibili|哔哩|头条|douyin|抖音|京东/i },
  { site: 'weibo', keywords: /微博|weibo|新浪微博/i, exclude: /知乎|zhihu|豆瓣|bilibili|哔哩/i },
]

function parseTaskLimitStructural(task) {
  const t = String(task ?? '').trim()
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

function inferSite(task) {
  for (const rule of SITE_RULES) {
    if (!rule.keywords.test(task)) continue
    if (rule.exclude?.test(task)) continue
    return rule.site
  }
  return 'generic'
}

const cases = [
  { task: '抓一下知乎热榜前三', expectSite: 'zhihu', expectLimit: 3 },
  { task: '帮我看下微博热搜，给我十条', expectSite: 'weibo', expectLimit: 10 },
  { task: '知乎和微博哪个更火', expectSite: 'generic', expectLimit: null },
]

let failed = 0
for (const c of cases) {
  const site = inferSite(c.task)
  const limit = parseTaskLimitStructural(c.task)
  const okSite = site === c.expectSite
  const okLimit = limit === c.expectLimit
  if (!okSite || !okLimit) {
    failed += 1
    console.error(`FAIL ${JSON.stringify(c.task)} site=${site} limit=${limit}`)
  } else {
    console.log(`OK   ${JSON.stringify(c.task)} site=${site} limit=${limit}`)
  }
}
if (failed > 0) {
  console.error(`structural-plan-check: ${failed} failed`)
  process.exit(1)
}
console.log('structural-plan-check: all passed')
