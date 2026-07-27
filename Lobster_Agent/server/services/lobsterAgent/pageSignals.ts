import type { Page } from 'playwright'

export type PageSignals = {
  scrollY: number
  h1Text: string
  hasVideo: boolean
  searchValue: string
  firstLinkHref: string
  linkCount: number
}

export async function collectPageSignals(page: Page): Promise<PageSignals> {
  const pageHost = (() => {
    try {
      return String(page.url() || '')
    } catch {
      return ''
    }
  })()
  const sig = await page
    .evaluate((locHref: string) => {
      const doc: any = (globalThis as any).document
      const win: any = (globalThis as any).window
      const toText = (el: any) => String(el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim()
      const isVisible = (el: any) => {
        try {
          const st = win?.getComputedStyle?.(el)
          if (st && (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity || '1') <= 0.01)) return false
          if (String(st.pointerEvents || '').toLowerCase() === 'none') return false
          const r = el?.getBoundingClientRect?.()
          if (!r) return false
          if (r.width <= 2 || r.height <= 2) return false
          const vw = Number(win?.innerWidth || 1280)
          const vh = Number(win?.innerHeight || 720)
          if (r.bottom < 0 || r.right < 0 || r.left > vw || r.top > vh) return false
          return true
        } catch {
          return false
        }
      }
      const scrollY = Math.floor(Number(win?.scrollY || 0))
      const h1 = Array.from(doc?.querySelectorAll?.('h1') ?? []).find((x: any) => isVisible(x))
      const h1Text = h1 ? toText(h1).slice(0, 120) : ''
      const hasVideo =
        Array.from(doc?.querySelectorAll?.('video') ?? []).some((v: any) => isVisible(v)) ||
        Array.from(doc?.querySelectorAll?.('audio') ?? []).some((a: any) => isVisible(a))
      const searchInput =
        doc?.querySelector?.('input[type="search"]') ||
        doc?.querySelector?.('input[name*="q" i]') ||
        doc?.querySelector?.('input[placeholder*="搜索" i]') ||
        doc?.querySelector?.('input[aria-label*="搜索" i]') ||
        doc?.querySelector?.('input')
      const searchValue = String((searchInput as any)?.value || '').replace(/\s+/g, ' ').trim().slice(0, 80)
      const anchors = Array.from(doc?.querySelectorAll?.('a[href]') ?? []) as any[]
      let firstLinkHref = ''
      let linkCount = 0
      for (const a of anchors) {
        if (!isVisible(a)) continue
        const href = String(a?.href || '').trim()
        if (!href) continue
        if (/^javascript:|^mailto:|^tel:/i.test(href)) continue
        linkCount++
        if (!firstLinkHref) firstLinkHref = href
        if (linkCount >= 80 && firstLinkHref) break
      }
      return { scrollY, h1Text, hasVideo, searchValue, firstLinkHref: String(firstLinkHref || ''), linkCount }
    }, pageHost)
    .catch(() => ({ scrollY: 0, h1Text: '', hasVideo: false, searchValue: '', firstLinkHref: '', linkCount: 0 }))
  return sig as PageSignals
}
