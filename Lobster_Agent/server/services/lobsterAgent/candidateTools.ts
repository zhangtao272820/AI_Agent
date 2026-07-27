import crypto from 'node:crypto'
import type { Page } from 'playwright'

function normalizeHost(host: string) {
  return String(host || '').trim().toLowerCase().replace(/\.$/, '')
}

export async function collectCandidates(page: Page, limit: number) {
  const n = Number.isFinite(limit) && limit > 0 ? Math.min(80, Math.floor(limit)) : 35
  const perFrame = Math.max(60, Math.min(160, n * 4))

  const baseHost = (() => {
    try {
      return normalizeHost(new URL(String(page.url() || '')).hostname)
    } catch {
      return ''
    }
  })()
  const framesAll = page.frames()
  const uniq: any[] = []
  const seenFrame = new Set<any>()
  const pushFrame = (f: any) => {
    if (!f) return
    if (seenFrame.has(f)) return
    seenFrame.add(f)
    uniq.push(f)
  }
  pushFrame(page.mainFrame())
  for (const f of framesAll) {
    try {
      const host = normalizeHost(new URL(String(f.url() || '')).hostname)
      if (baseHost && host === baseHost) pushFrame(f)
    } catch {}
  }
  for (const f of framesAll) pushFrame(f)
  const frames = uniq.slice(0, 25)
  const all: any[] = []
  for (let i = 0; i < frames.length; i++) {
    const frame: any = frames[i]
    const domItems = await frame
      .evaluate(
        (maxN: number) => {
          const doc: any = (globalThis as any).document
          const win: any = (globalThis as any).window
          const cssEscape = (v: string) => {
            const CSSAny: any = (globalThis as any).CSS
            if (CSSAny?.escape) return String(CSSAny.escape(v))
            return String(v || '').replace(/[^a-zA-Z0-9_-]/g, (m) => `\\${m}`)
          }
          const escapeForHasText = (s: string) => String(s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ').trim()
          const toText = (el: any) => String(el?.textContent || '').replace(/\s+/g, ' ').trim()
          const clickableHeuristic = (el: any) => {
            if (!el) return false
            const tag = String(el?.tagName || '').toUpperCase()
            const role = String(el?.getAttribute?.('role') || '').toLowerCase()
            if (['BUTTON', 'A', 'INPUT', 'TEXTAREA', 'SELECT', 'SUMMARY'].includes(tag)) return true
            if (/button|link|tab|menuitem|option|checkbox|radio/.test(role)) return true
            if (typeof el?.onclick === 'function') return true
            const tabindex = String(el?.getAttribute?.('tabindex') || '').trim()
            if (tabindex && tabindex !== '-1') return true
            const cls = String(el?.className || '')
            if (/(btn|button|card|item|result|entry|cell|tile|tab|menu|option|trigger|cta|submit|search)/i.test(cls)) return true
            const st = win?.getComputedStyle?.(el)
            if (String(st?.cursor || '').toLowerCase() === 'pointer') return true
            return false
          }
          const pickLabel = (el: any) => {
            const aria = String(el?.getAttribute?.('aria-label') || '').trim()
            if (aria) return aria
            const title = String(el?.getAttribute?.('title') || '').trim()
            if (title) return title
            const placeholder = String(el?.getAttribute?.('placeholder') || '').trim()
            if (placeholder) return placeholder
            const txt = toText(el)
            if (txt) return txt
            const value = String(el?.value || '').trim()
            if (value) return value
            return ''
          }
          const closestContextText = (el: any) => {
            const scopes = [
              el?.closest?.('[role="dialog"]'),
              el?.closest?.('article'),
              el?.closest?.('li'),
              el?.closest?.('[class*="card" i]'),
              el?.closest?.('[class*="item" i]'),
              el?.closest?.('[class*="result" i]'),
              el?.closest?.('section'),
              el?.parentElement
            ].filter(Boolean)
            for (const scope of scopes) {
              const txt = toText(scope)
              if (txt && txt.length >= 6) return txt.slice(0, 180)
            }
            return ''
          }
          const cssPathOf = (el: any) => {
            try {
              const parts: string[] = []
              let cur = el
              let depth = 0
              while (cur && cur.nodeType === 1 && depth < 5) {
                const tag = String(cur.tagName || '').toLowerCase()
                if (!tag) break
                const id = String(cur.id || '').trim()
                if (id) {
                  parts.unshift(`${tag}#${cssEscape(id)}`)
                  break
                }
                let nth = 1
                let sib = cur
                while ((sib = sib.previousElementSibling)) nth++
                parts.unshift(`${tag}:nth-child(${nth})`)
                cur = cur.parentElement
                depth++
              }
              return parts.join(' > ').slice(0, 220)
            } catch {
              return ''
            }
          }
          const score = (label: string, tag: string, role: string) => {
            const s = String(label || '').trim()
            if (!s) {
              if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return 14
              if (/textbox|searchbox|combobox|input/i.test(String(role || ''))) return 14
              return 0
            }
            let v = 10
            if (tag === 'BUTTON' || role === 'button') v += 9
            if (tag === 'A' || role === 'link') v += 7
            if (s.length <= 18) v += 6
            if (/登录|注册|submit|search|next|确定|确认|继续|保存|发送|查询|搜索|播放|暂停/i.test(s)) v += 10
            return v
          }
          const isVisible = (el: any) => {
            if (!el) return false
            const style = win?.getComputedStyle?.(el)
            if (style) {
              if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || '1') <= 0.01) return false
              if (String(style.pointerEvents || '').toLowerCase() === 'none') return false
            }
            const r = el.getBoundingClientRect?.()
            if (!r) return true
            if (r.width <= 2 || r.height <= 2) return false
            const vw = Number(win?.innerWidth || 1280)
            const vh = Number(win?.innerHeight || 720)
            if (r.bottom < 0 || r.right < 0 || r.left > vw || r.top > vh) return false
            return true
          }
          const bboxOf = (el: any) => {
            const r = el.getBoundingClientRect?.()
            if (!r) return null
            const x = Math.max(0, Math.round(r.left))
            const y = Math.max(0, Math.round(r.top))
            const w = Math.max(0, Math.round(r.width))
            const h = Math.max(0, Math.round(r.height))
            if (w <= 2 || h <= 2) return null
            return { x, y, width: w, height: h }
          }

          const roots: any[] = [doc]
          try {
            const all = Array.from(doc?.querySelectorAll?.('*') ?? []) as any[]
            let added = 0
            for (const el of all) {
              if (added >= 120) break
              const sr = (el as any)?.shadowRoot
              if (sr && typeof sr.querySelectorAll === 'function') {
                roots.push(sr)
                added++
              }
            }
          } catch {}

          const sel = [
            'button',
            'a[href]',
            '[role="button"]',
            '[role="link"]',
            '[role="tab"]',
            '[role="menuitem"]',
            'input:not([type="hidden"])',
            'textarea',
            'select',
            '[onclick]',
            '[tabindex]:not([tabindex="-1"])',
            '[data-testid]',
            '[data-action]',
            '[data-click]'
          ].join(',')

          const nodes: any[] = []
          const seenEl = new Set<any>()
          for (const r of roots) {
            const list = Array.from(r?.querySelectorAll?.(sel) ?? []) as any[]
            for (const el of list) {
              if (nodes.length >= 1800) break
              if (seenEl.has(el)) continue
              seenEl.add(el)
              nodes.push(el)
            }
            if (nodes.length >= 1800) break
          }

          const raw: any[] = []
          for (const el of nodes) {
            if (!isVisible(el)) continue
            const tag = String(el?.tagName || '').toUpperCase()
            const role = String(el?.getAttribute?.('role') || '').toLowerCase()
            const ariaLabel = String(el?.getAttribute?.('aria-label') || '').trim()
            const title = String(el?.getAttribute?.('title') || '').trim()
            const placeholder = String(el?.getAttribute?.('placeholder') || '').trim()
            const nameAttr = String(el?.getAttribute?.('name') || '').trim()
            const idAttr = String(el?.id || '').trim()
            const labelRaw = pickLabel(el)
            const label = String(labelRaw || '').replace(/\s+/g, ' ').trim().slice(0, 80)
            const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
            if (!label && !isInput && !clickableHeuristic(el)) continue

            let kind = 'other'
            if (tag === 'A' || role === 'link') kind = 'link'
            else if (tag === 'BUTTON' || role === 'button') kind = 'button'
            else if (role === 'tab' || role === 'menuitem') kind = 'button'
            else if (isInput) kind = 'input'

            let selector = ''
            if (kind === 'input') {
              const ph = String(el?.getAttribute?.('placeholder') || '').trim().slice(0, 30)
              const name = String(el?.getAttribute?.('name') || '').trim().slice(0, 40)
              const id = String(el?.id || '').trim()
              if (id) selector = `#${cssEscape(id)}`
              else if (name) selector = `${tag.toLowerCase()}[name="${name.replace(/"/g, '\\"')}"]`
              else if (ph) selector = `${tag.toLowerCase()}[placeholder*="${ph.replace(/"/g, '\\"')}"]`
              else if (label) selector = `${tag.toLowerCase()}[aria-label*="${label.replace(/"/g, '\\"')}"], ${tag.toLowerCase()}[title*="${label.replace(/"/g, '\\"')}"]`
              else selector = tag.toLowerCase()
            } else {
              const safe = escapeForHasText(label)
              const base = tag === 'A' ? 'a' : tag === 'BUTTON' ? 'button' : role === 'link' ? '[role="link"]' : '[role="button"]'
              const testId = String(el?.getAttribute?.('data-testid') || el?.getAttribute?.('data-test') || '').trim()
              const id = String(el?.id || '').trim()
              const href = tag === 'A' ? String((el as any)?.href || el?.getAttribute?.('href') || '').trim() : ''
              if (id) selector = `#${cssEscape(id)}`
              else if (testId) selector = `[data-testid="${testId.replace(/"/g, '\\"')}"]`
              else if (href && href.length <= 180) selector = `a[href="${href.replace(/"/g, '\\"')}"]`
              else selector = `${base}:has-text("${safe}")`
            }

            const rect = el.getBoundingClientRect?.()
            const cx = rect ? rect.left + rect.width / 2 : 0
            const cy = rect ? rect.top + rect.height / 2 : 0
            const vw = Number(win?.innerWidth || 1280)
            const vh = Number(win?.innerHeight || 720)
            const dcx = Math.abs(cx - vw / 2)
            const dcy = Math.abs(cy - vh / 2)
            const dnorm = Math.min(1, Math.sqrt(dcx * dcx + dcy * dcy) / Math.sqrt((vw / 2) ** 2 + (vh / 2) ** 2))
            const disabled = !!(el as any)?.disabled || String(el?.getAttribute?.('aria-disabled') || '').trim() === 'true'
            const danger = /(购买|支付|下单|提交订单|确认支付|删除|移除|退订|开通|订阅|充值)/i.test(label)
            let sVal = score(label, tag, role)
            sVal += Math.max(0, Math.round((1 - dnorm) * 6))
            if (disabled) sVal -= 10
            if (danger) sVal -= 12

            raw.push({
              source: 'dom',
              kind,
              tag,
              role,
              label,
              ariaLabel: ariaLabel.slice(0, 60),
              title: title.slice(0, 60),
              placeholder: placeholder.slice(0, 60),
              name: nameAttr.slice(0, 60),
              id: idAttr.slice(0, 60),
              href: tag === 'A' ? String((el as any)?.href || el?.getAttribute?.('href') || '').slice(0, 220) : '',
              exactText: label.slice(0, 80),
              contextText: closestContextText(el),
              domPath: cssPathOf(el),
              selector,
              bbox: bboxOf(el),
              score: sVal
            })
          }

          raw.sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
          const out: any[] = []
          const seen = new Set<string>()
          for (const r of raw) {
            if (!r.selector && !r.role) continue
            const key = `${r.source}:${r.kind}:${r.selector}:${r.role}:${r.label}`
            if (seen.has(key)) continue
            seen.add(key)
            out.push(r)
            if (out.length >= maxN) break
          }
          return out
        },
        perFrame
      )
      .catch(() => [] as any[])

    let offX = 0
    let offY = 0
    if (frame !== page.mainFrame()) {
      try {
        const el = await frame.frameElement()
        const bb = await el.boundingBox()
        if (bb) {
          offX = bb.x
          offY = bb.y
        }
      } catch {}
    }

    for (const it of Array.isArray(domItems) ? domItems : []) {
      const bbox = it?.bbox
      if (bbox && typeof bbox === 'object') {
        bbox.x = Math.max(0, Math.round(Number(bbox.x || 0) + offX))
        bbox.y = Math.max(0, Math.round(Number(bbox.y || 0) + offY))
      }
      all.push({ ...it, frameIndex: i, frameUrl: String(frame.url() || ''), frameName: String(frame.name() || '') })
    }
  }

  const a11y = await (page as any).accessibility?.snapshot?.({ interestingOnly: true }).catch(() => null as any)
  const a11yItems: any[] = []
  const walk = (node: any, depth: number) => {
    if (!node || typeof node !== 'object') return
    if (depth > 30) return
    const role = String(node.role || '').trim().toLowerCase()
    const name = String(node.name || '').replace(/\s+/g, ' ').trim()
    if (name && role && !/generic|section|paragraph|statictext|text/i.test(role)) {
      let kind = 'other'
      if (/button/.test(role)) kind = 'button'
      else if (/link/.test(role)) kind = 'link'
      else if (/textbox|searchbox|combobox/.test(role)) kind = 'input'
      const label = name.length > 40 ? name.slice(0, 40) : name
      let sVal = 10
      if (kind === 'button') sVal += 8
      if (kind === 'link') sVal += 6
      if (kind === 'input') sVal += 7
      if (/登录|注册|submit|search|next|确定|确认|继续|保存|发送|查询|搜索|播放|暂停/i.test(label)) sVal += 10
      a11yItems.push({
        source: 'a11y',
        kind,
        tag: '',
        role,
        label,
        ariaLabel: '',
        title: '',
        placeholder: '',
        name: '',
        id: '',
        selector: '',
        bbox: null,
        score: sVal
      })
    }
    const kids = Array.isArray(node.children) ? node.children : []
    for (const c of kids) walk(c, depth + 1)
  }
  walk(a11y, 0)

  const merged = [...all, ...a11yItems]
  merged.sort((a, b) => Number(b?.score || 0) - Number(a?.score || 0))
  const out: any[] = []
  const seen = new Set<string>()
  for (const r of merged) {
    const key = `${String(r?.source || '')}:${String(r?.frameIndex ?? '')}:${String(r?.kind || '')}:${String(r?.selector || '')}:${String(r?.role || '')}:${String(r?.label || '')}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      source: r.source,
      kind: r.kind,
      label: r.label,
      selector: r.selector,
      tag: r.tag,
      role: r.role,
      ariaLabel: r.ariaLabel,
      title: r.title,
      placeholder: r.placeholder,
      name: r.name,
      id: r.id,
      exactText: (r as any).exactText,
      contextText: (r as any).contextText,
      domPath: (r as any).domPath,
      href: (r as any).href,
      bbox: r.bbox,
      frameIndex: r.frameIndex,
      frameUrl: r.frameUrl,
      frameName: r.frameName,
      score: r.score
    })
    if (out.length >= n) break
  }
  const textOf = (x: any) =>
    `${String(x?.label || '')} ${String(x?.ariaLabel || '')} ${String(x?.title || '')} ${String(x?.placeholder || '')}`.replace(/\s+/g, ' ').trim()
  const has = (re: RegExp) => out.some((c) => re.test(textOf(c)))
  const injectBest = (re: RegExp) => {
    if (has(re)) return
    const best = merged.find((m) => re.test(textOf(m)))
    if (!best) return
    const item = {
      source: best.source,
      kind: best.kind,
      label: best.label,
      selector: best.selector,
      tag: best.tag,
      role: best.role,
      ariaLabel: best.ariaLabel,
      title: best.title,
      placeholder: best.placeholder,
      name: best.name,
      id: best.id,
      exactText: (best as any).exactText,
      contextText: (best as any).contextText,
      domPath: (best as any).domPath,
      href: (best as any).href,
      bbox: best.bbox,
      frameIndex: best.frameIndex,
      frameUrl: best.frameUrl,
      frameName: best.frameName,
      score: best.score
    }
    const k = `${String(item.source || '')}:${String(item.frameIndex ?? '')}:${String(item.kind || '')}:${String(item.selector || '')}:${String(item.role || '')}:${String(item.label || '')}`
    if (seen.has(k)) return
    if (out.length >= n) out.pop()
    out.push(item)
    seen.add(k)
  }
  injectBest(/搜索|search|keyword|query/i)
  injectBest(/关闭|取消|我知道了|同意|继续|accept|agree|close/i)
  injectBest(/播放|play/i)
  const makeCid = (c: any) => {
    const key = [
      String(c?.source || ''),
      String(c?.frameUrl || ''),
      String(c?.kind || ''),
      String(c?.selector || ''),
      String(c?.role || ''),
      String(c?.label || ''),
      String(c?.ariaLabel || ''),
      String(c?.title || ''),
      String(c?.placeholder || ''),
      String(c?.contextText || ''),
      String(c?.domPath || ''),
      String(c?.href || ''),
      c?.bbox ? `${Number(c.bbox.x || 0)},${Number(c.bbox.y || 0)},${Number(c.bbox.width || 0)},${Number(c.bbox.height || 0)}` : ''
    ].join('|')
    const h = crypto.createHash('sha1').update(key).digest('hex').slice(0, 12)
    return `c_${h}`
  }
  return (Array.isArray(out) ? out : []).map((c) => ({ ...(c || {}), cid: makeCid(c) }))
}

export async function renderOverlayScreenshot(page: Page, candidates: any[], topN = 30) {
  const capped = Math.max(1, Math.min(50, Math.floor(Number(topN) || 30)))
  const items = (Array.isArray(candidates) ? candidates : [])
    .map((c, i) => ({ c: c || {}, i }))
    .filter((x) => {
      const b = x.c?.bbox
      if (!b || typeof b !== 'object') return false
      const nums = [Number(b.x), Number(b.y), Number(b.width), Number(b.height)]
      return nums.every((n) => Number.isFinite(n)) && Number(b.width) > 2 && Number(b.height) > 2
    })
    .slice(0, capped)
    .map((x) => ({
      i: x.i,
      x: Math.max(0, Math.floor(Number(x.c.bbox.x || 0))),
      y: Math.max(0, Math.floor(Number(x.c.bbox.y || 0))),
      w: Math.max(2, Math.floor(Number(x.c.bbox.width || 0))),
      h: Math.max(2, Math.floor(Number(x.c.bbox.height || 0)))
    }))
  if (!items.length) return ''

  const layerId = `__lobster_overlay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const styleId = `${layerId}__style`
  try {
    await page
      .evaluate(
        ({ layerId, styleId, items }) => {
          const doc: any = (globalThis as any).document
          if (!doc?.body) return
          const prevLayer = doc.getElementById(layerId)
          if (prevLayer) prevLayer.remove()
          const prevStyle = doc.getElementById(styleId)
          if (prevStyle) prevStyle.remove()

          const style = doc.createElement('style')
          style.id = styleId
          style.textContent = `
            #${layerId}{position:fixed;inset:0;z-index:2147483647;pointer-events:none;}
            #${layerId} .lob-box{position:fixed;border:2px solid rgba(59,130,246,.95);background:rgba(59,130,246,.12);border-radius:6px;box-sizing:border-box;}
            #${layerId} .lob-tag{position:absolute;left:-1px;top:-20px;background:rgba(30,64,175,.98);color:#fff;font:700 12px/1.2 ui-sans-serif,system-ui;padding:2px 6px;border-radius:4px;white-space:nowrap;}
          `
          doc.documentElement.appendChild(style)

          const layer = doc.createElement('div')
          layer.id = layerId
          for (const it of Array.isArray(items) ? items : []) {
            const box = doc.createElement('div')
            box.className = 'lob-box'
            box.style.left = `${Math.max(0, Number((it as any).x || 0))}px`
            box.style.top = `${Math.max(0, Number((it as any).y || 0))}px`
            box.style.width = `${Math.max(2, Number((it as any).w || 2))}px`
            box.style.height = `${Math.max(2, Number((it as any).h || 2))}px`
            const tag = doc.createElement('span')
            tag.className = 'lob-tag'
            tag.textContent = `#${Math.max(0, Math.floor(Number((it as any).i || 0)))}`
            box.appendChild(tag)
            layer.appendChild(box)
          }
          doc.body.appendChild(layer)
        },
        { layerId, styleId, items }
      )
      .catch(() => {})

    const buf = await page.screenshot({ type: 'jpeg', quality: 65, fullPage: false }).catch(() => null as any)
    if (!buf) return ''
    return `data:image/jpeg;base64,${Buffer.from(buf).toString('base64')}`
  } finally {
    await page
      .evaluate(
        ({ layerId, styleId }) => {
          const doc: any = (globalThis as any).document
          doc?.getElementById?.(layerId)?.remove?.()
          doc?.getElementById?.(styleId)?.remove?.()
        },
        { layerId, styleId }
      )
      .catch(() => {})
  }
}
