/**
 * 正文 excerpt 抽取：结构性 DOM 启发（article/main），非正则语义。
 */
import { load } from 'cheerio'

const DEFAULT_ARTICLE_SELECTORS = [
  'article',
  'main',
  '[role=main]',
  '.article-content',
  '.post-content',
  '.entry-content',
  '#content',
  '.content',
  '.article',
  '.post',
]

function normalizeWhitespace(text: string) {
  return String(text ?? '').replace(/\s+/g, ' ').trim()
}

function scoreBlock(text: string, linkCount: number): number {
  const len = text.length
  if (len < 80) return 0
  const linkPenalty = linkCount * 12
  return len - linkPenalty
}

export function extractArticleExcerpt(html: string, selectors?: string[]): string {
  const $ = load(html)
  $('script, style, noscript, svg, iframe, nav, header, footer, aside').remove()
  const sels = (selectors?.length ? selectors : DEFAULT_ARTICLE_SELECTORS).map(String).filter(Boolean)

  let best = ''
  let bestScore = 0
  for (const sel of sels) {
    $(sel).each((_, el) => {
      const node = $(el)
      const text = normalizeWhitespace(node.text())
      const links = node.find('a[href]').length
      const sc = scoreBlock(text, links)
      if (sc > bestScore) {
        bestScore = sc
        best = text
      }
    })
  }

  if (!best) {
    const bodyText = normalizeWhitespace($('body').text())
    if (bodyText.length > 120) best = bodyText
  }

  return best.slice(0, 1200)
}

export function enrichItemsWithExcerpts(
  items: Array<Record<string, unknown>>,
  html: string,
  selectors?: string[],
): Array<Record<string, unknown>> {
  const excerpt = extractArticleExcerpt(html, selectors)
  if (!excerpt) return items
  return items.map((it) => {
    const has = String(it.excerpt ?? it.summary ?? '').trim()
    if (has) return it
    return { ...it, excerpt }
  })
}
