export type CrawlerSourceItem = {
  title: string
  url: string
  source: string
  excerpt: string
}

function stripMdLink(text: string): string {
  return String(text ?? '')
    .replace(/\[([^\]]*)\]\([^)]+\)/g, '$1')
    .trim()
}

function extractUrlFromCell(cell: string): string {
  const c = String(cell ?? '').trim()
  const m = c.match(/https?:\/\/[^\s)]+/i)
  return m ? m[0]! : ''
}

function inferHostFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '')
  } catch {
    return ''
  }
}

function isRankOrIndexCell(cell: string): boolean {
  const t = String(cell ?? '').trim()
  return /^\d{1,3}$/.test(t) || /^#?\d{1,3}$/.test(t)
}

function isPlaceholderCell(cell: string): boolean {
  const t = String(cell ?? '').trim()
  return !t || /^[-—]+$/.test(t)
}

function headerIndex(headers: string[], names: string[]): number {
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i]!.toLowerCase()
    if (names.some((n) => h.includes(n))) return i
  }
  return -1
}

function parseMarkdownTableRows(md: string): CrawlerSourceItem[] {
  const lines = String(md ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('|'))
  if (lines.length < 2) return []

  const headerCells = lines[0]!
    .split('|')
    .map((c) => c.trim())
    .filter(Boolean)
  const idxRank = headerIndex(headerCells, ['序号', '排名', 'rank', '#'])
  const idxTitle = headerIndex(headerCells, ['标题', 'title', '名称', 'name'])
  const idxSource = headerIndex(headerCells, ['站点', '来源', 'source', '域名'])
  const idxUrl = headerIndex(headerCells, ['链接', 'url', 'link', 'href'])
  const idxRating = headerIndex(headerCells, ['评分', 'rating'])

  const dataLines = lines.slice(2).filter((l) => !/^\|\s*[-—:]+\s*\|/.test(l) && !/排名/.test(l))

  return dataLines
    .map((row) => {
      const cells = row
        .split('|')
        .map((c) => c.trim())
        .filter(Boolean)
      if (!cells.length) return null

      let title = ''
      let url = ''
      let source = ''

      if (idxTitle >= 0 && cells[idxTitle]) {
        title = stripMdLink(cells[idxTitle]!)
      }
      if (idxUrl >= 0 && cells[idxUrl]) {
        url = extractUrlFromCell(cells[idxUrl]!)
      }
      if (idxSource >= 0 && cells[idxSource]) {
        source = stripMdLink(cells[idxSource]!)
      }

      if (!url) {
        for (const c of cells) {
          const u = extractUrlFromCell(c)
          if (u) {
            url = u
            break
          }
        }
      }

      if (!title) {
        for (let i = 0; i < cells.length; i++) {
          if (i === idxRank || i === idxUrl || i === idxRating) continue
          const c = stripMdLink(cells[i]!)
          if (!c || isPlaceholderCell(c) || isRankOrIndexCell(c) || extractUrlFromCell(c)) continue
          title = c
          break
        }
      }

      if (!source && url) source = inferHostFromUrl(url)
      if (!title && url) title = inferHostFromUrl(url) || url.slice(0, 60)
      if (isPlaceholderCell(title) && url) title = inferHostFromUrl(url) || '—'

      return {
        title: title || '—',
        url,
        source: source || (url ? inferHostFromUrl(url) : '—') || '—',
        excerpt: ''
      }
    })
    .filter((x): x is CrawlerSourceItem => Boolean(x))
}

function parseBulletSourceLines(text: string): CrawlerSourceItem[] {
  const out: CrawlerSourceItem[] = []
  for (const line of String(text ?? '').split('\n')) {
    const m = line.match(/^\s*[-*]\s*(\d+)[.\)、]?\s*(.+?)\s*\|\s*([^|]+?)\s*\|\s*(https?:\/\/\S+)/i)
    if (!m) continue
    const title = String(m[2] ?? '').trim()
    const source = String(m[3] ?? '').trim()
    const url = String(m[4] ?? '').trim()
    out.push({
      title: title || inferHostFromUrl(url) || '—',
      url,
      source: source && !/^[-—]+$/.test(source) ? source : inferHostFromUrl(url) || '—',
      excerpt: ''
    })
  }
  return out
}

export function normalizeCrawlerItem(raw: Record<string, unknown>): CrawlerSourceItem {
  const url = String(raw.url ?? raw.link ?? '').trim()
  let title = String(raw.title ?? raw.name ?? '').trim()
  let source = String(raw.source ?? '').trim()
  if (!source && url) source = inferHostFromUrl(url)
  if (!title || title === '-') {
    title = url ? inferHostFromUrl(url) || url.slice(0, 80) : '—'
  }
  return {
    title,
    url,
    source: source || '—',
    excerpt: String(raw.excerpt ?? raw.snippet ?? raw.description ?? '').trim()
  }
}

export function extractCrawlerItemsFromPayload(raw: unknown): CrawlerSourceItem[] {
  if (!raw) return []
  if (typeof raw === 'string') return extractCrawlerItemsFromText(raw)
  if (typeof raw !== 'object') return []

  const seen = new Set<string>()
  const out: CrawlerSourceItem[] = []
  const push = (items: CrawlerSourceItem[]) => {
    for (const it of items) {
      const key = `${it.url}|${it.title}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(it)
    }
  }

  const walk = (obj: Record<string, unknown>) => {
    for (const k of ['items', 'results', 'data']) {
      const arr = obj[k]
      if (Array.isArray(arr) && arr.length) {
        push(
          arr
            .filter((x) => x && typeof x === 'object')
            .map((x) => normalizeCrawlerItem(x as Record<string, unknown>))
        )
      }
    }
    const ar = obj.agentResult
    if (ar && typeof ar === 'object') {
      const agent = ar as Record<string, unknown>
      const structured = agent.structured
      if (structured && typeof structured === 'object') {
        const preview = (structured as Record<string, unknown>).preview
        if (Array.isArray(preview) && preview.length) {
          push(
            preview
              .filter((x) => x && typeof x === 'object')
              .map((x) => normalizeCrawlerItem(x as Record<string, unknown>))
          )
        }
      }
      const sources = agent.sources
      if (Array.isArray(sources)) {
        push(
          sources
            .map((s) => {
              const row = s && typeof s === 'object' ? (s as Record<string, unknown>) : {}
              const url = String(row.ref ?? row.url ?? '').trim()
              return normalizeCrawlerItem({ url, title: url ? inferHostFromUrl(url) : '来源' })
            })
            .filter((x) => x.url || x.title)
        )
      }
      const answer = String(agent.answer ?? '').trim()
      if (answer) push(extractCrawlerItemsFromText(answer))
    }
    const result = obj.result
    if (result && typeof result === 'object') walk(result as Record<string, unknown>)
  }

  walk(raw as Record<string, unknown>)
  return out
}

export function extractCrawlerItemsFromText(text: string): CrawlerSourceItem[] {
  const t = String(text ?? '')
  const blockStart = t.indexOf('<!--CRAWLER_TABLE-->')
  const blockEnd = t.indexOf('<!--/CRAWLER_TABLE-->')
  const tableMd =
    blockStart >= 0 && blockEnd > blockStart
      ? t.slice(blockStart + '<!--CRAWLER_TABLE-->'.length, blockEnd).trim()
      : ''

  if (tableMd) {
    const fromTable = parseMarkdownTableRows(tableMd)
    if (fromTable.length) return fromTable
  }

  const fromBullets = parseBulletSourceLines(t)
  if (fromBullets.length) return fromBullets

  try {
    const parsed = JSON.parse(t)
    return extractCrawlerItemsFromPayload(parsed)
  } catch {
    return []
  }
}

export function formatSourcesTableMarkdown(items: CrawlerSourceItem[], maxRows = 5): string {
  const rows = items.slice(0, maxRows)
  if (!rows.length) return ''
  const header = '| 序号 | 标题 | 站点 | 链接 |'
  const sep = '| --- | --- | --- | --- |'
  const body = rows.map((item, idx) => {
    const title = String(item.title || '—').replace(/\|/g, '\\|').slice(0, 48)
    const source = String(item.source || '—').replace(/\|/g, '\\|').slice(0, 28)
    const url = item.url ? `[查看](${item.url})` : '—'
    return `| ${idx + 1} | ${title} | ${source} | ${url} |`
  })
  return [header, sep, ...body].join('\n')
}

const CRAWLER_TABLE_BEGIN = '<!--CRAWLER_TABLE-->'
const CRAWLER_TABLE_END = '<!--/CRAWLER_TABLE-->'

/** 从爬虫原始输出（文本/JSON/已嵌表格）解析出 Markdown 表格 */
export function resolveCrawlerTableMarkdown(raw: unknown, maxRows = 8): string {
  const text = typeof raw === 'string' ? String(raw).trim() : ''
  if (text) {
    const start = text.indexOf(CRAWLER_TABLE_BEGIN)
    const end = text.indexOf(CRAWLER_TABLE_END)
    if (start >= 0 && end > start) {
      const embedded = text.slice(start + CRAWLER_TABLE_BEGIN.length, end).trim()
      if (embedded) return embedded
    }
    const fromText = extractCrawlerItemsFromText(text)
    if (fromText.length) return formatSourcesTableMarkdown(fromText, maxRows)
  }
  const fromPayload = extractCrawlerItemsFromPayload(raw)
  if (fromPayload.length) return formatSourcesTableMarkdown(fromPayload, maxRows)
  return ''
}

export function buildCrawlerSourcesTaggedBlock(raw: unknown, maxRows = 8): string {
  const md = resolveCrawlerTableMarkdown(raw, maxRows)
  if (!md) return ''
  return `${CRAWLER_TABLE_BEGIN}\n${md}\n${CRAWLER_TABLE_END}`
}

export function crawlerSourceHitsForEvent(
  raw: unknown,
  cap = 8
): Array<{ title: string; url: string; source?: string }> {
  const block = buildCrawlerSourcesTaggedBlock(raw, cap)
  const items = block ? extractCrawlerItemsFromText(block) : extractCrawlerItemsFromPayload(raw)
  return items
    .slice(0, cap)
    .map((it) => ({
      title: String(it.title || it.url || '来源').trim(),
      url: String(it.url || '').trim(),
      source: String(it.source || '').trim() || undefined
    }))
    .filter((it) => it.title || it.url)
}
