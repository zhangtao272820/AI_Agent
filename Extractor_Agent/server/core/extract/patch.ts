/**
 * 补丁 listSelectors 确定性抽取（无 LLM）。
 */
import { load } from 'cheerio'
import type { SitePatchListSelectors } from '../../services/patchRegistry'

function normalizeWhitespace(text: string) {
  return String(text ?? '').replace(/\s+/g, ' ').trim()
}

function readSelectorValue($: ReturnType<typeof load>, el: any, spec: string, baseUrl: string): string {
  const s = String(spec ?? '').trim()
  if (!s) return ''
  if (s === '@text') return normalizeWhitespace($(el).text())
  if (s === '@href') {
    const href = String($(el).attr('href') ?? '').trim()
    if (!href) return ''
    try {
      return href.startsWith('http') ? href : new URL(href, baseUrl).toString()
    } catch {
      return href
    }
  }
  if (s.startsWith('@')) {
    const attr = s.slice(1)
    return normalizeWhitespace(String($(el).attr(attr) ?? ''))
  }
  const nested = $(el).find(s).first()
  if (!nested.length) return normalizeWhitespace($(el).text())
  return normalizeWhitespace(nested.text())
}

export function extractWithListSelectors(
  html: string,
  baseUrl: string,
  selectors: SitePatchListSelectors,
  maxItems: number,
): Array<Record<string, unknown>> {
  const $ = load(html)
  const itemSel = String(selectors.item ?? '').trim()
  if (!itemSel) return []

  const items: Array<Record<string, unknown>> = []
  const seen = new Set<string>()

  $(itemSel).each((_, el) => {
    if (items.length >= maxItems) return
    const titleSpec = selectors.title ?? '@text'
    const urlSpec = selectors.url ?? '@href'
    const title = readSelectorValue($, el, titleSpec, baseUrl)
    let url = readSelectorValue($, el, urlSpec === '@href' ? '@href' : urlSpec, baseUrl)
    if (!url && urlSpec !== '@href') {
      url = readSelectorValue($, el, '@href', baseUrl)
    }
    if (!title && !url) return
    const key = url || title
    if (seen.has(key)) return
    seen.add(key)
    const row: Record<string, unknown> = {
      title: title || url,
      url: url || baseUrl,
      source: 'patch',
    }
    if (selectors.rank) {
      const rankRaw = readSelectorValue($, el, selectors.rank, baseUrl)
      const rank = Number.parseInt(rankRaw, 10)
      if (Number.isFinite(rank)) row.rank = rank
    }
    if (selectors.excerpt) {
      const excerpt = readSelectorValue($, el, selectors.excerpt, baseUrl)
      if (excerpt) row.excerpt = excerpt.slice(0, 400)
    }
    items.push(row)
  })

  return items
}
