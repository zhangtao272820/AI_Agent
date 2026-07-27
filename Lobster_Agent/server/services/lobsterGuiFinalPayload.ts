/**
 * 确保 GUI 结果在交给 Manager / MCP 前具备可读 answer（P3-L5）
 * 不依赖 #agent-shared，便于 smoke/tsx 与 Docker 共用。
 */

function searchTaskRequiresContentPayload(task: string): boolean {
  const t = String(task || '')
  if (!/(搜索|search|查找|query)/i.test(t)) return false
  return /(抽取|提取|获取|输出|列表|结果|items|前\s*\d+\s*条|top\s*\d+)/i.test(t)
}

function collectItems(data: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(data)) return []
  const out: Array<Record<string, unknown>> = []
  for (const chunk of data) {
    if (!chunk || typeof chunk !== 'object') continue
    const items = (chunk as Record<string, unknown>).items
    if (!Array.isArray(items)) continue
    for (const it of items) {
      if (it && typeof it === 'object') out.push(it as Record<string, unknown>)
    }
  }
  return out
}

function formatItemsAnswer(items: Array<Record<string, unknown>>, finalUrl: string): string {
  const lines = items.slice(0, 5).map((row, i) => {
    const title = String(row.title || row.text || row.label || '').trim().slice(0, 120)
    const url = String(row.url || row.href || row.link || '').trim()
    if (title && url) return `${i + 1}. ${title} — ${url}`
    if (title) return `${i + 1}. ${title}`
    if (url) return `${i + 1}. ${url}`
    return `${i + 1}. ${JSON.stringify(row).slice(0, 100)}`
  })
  const head = finalUrl ? `结果页：${finalUrl}` : ''
  return [head, ...lines].filter(Boolean).join('\n').trim()
}

/** 补全 answer：抽取类优先 items；其它搜索类至少写出 finalUrl */
export function ensureLobsterGuiFinalPayload(
  result: Record<string, unknown>,
  task: string,
): Record<string, unknown> {
  const row = { ...result }
  const finalUrl = String(row.finalUrl || row.url || '').trim()
  let answer = String(row.answer || row.summary || '').trim()
  const items = collectItems(row.data)
  const pageTitle = String(row.pageTitle || row.title || '').trim()

  if (items.length && answer.length < 12) {
    answer = formatItemsAnswer(items, finalUrl)
  }
  // 已打开详情：用标题+链接合成可读结论（避免 search_extract_empty / wait 环后空 answer）
  if (answer.length < 12 && finalUrl && pageTitle && !/wappass|\/captcha/i.test(finalUrl)) {
    const opened =
      /(打开|点击|进入|第一条|告诉我|标题|链接)/i.test(task) ||
      !/(抽取|提取|列表|items|前\s*\d+\s*条)/i.test(task)
    if (opened || !isLikelySerp(finalUrl)) {
      answer = `标题：${pageTitle}\n链接：${finalUrl}`
    }
  }
  if (!answer && finalUrl && !searchTaskRequiresContentPayload(task)) {
    answer = `页面：${finalUrl}`
  }
  if (answer) row.answer = answer
  return row
}

function isLikelySerp(url: string): boolean {
  const u = String(url || '')
  return /\/s(\?|$)/i.test(u) || /[?&](wd|q|query|keyword)=/i.test(u) || /\/search(\/|\?|$)/i.test(u)
}
