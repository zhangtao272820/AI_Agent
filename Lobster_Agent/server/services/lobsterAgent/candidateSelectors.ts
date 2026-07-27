import {
  detailLinkConfig,
  genericFirstResultConfig,
  globalIntentScoring,
  intentAliasMap,
  intentScoreRules,
  pickThreshold
} from './candidateSelectors.config'

import type { CandidateCondition, CandidateTarget } from './candidateSelectors.config'

function normalizeHost(host: string) {
  return String(host || '').trim().toLowerCase().replace(/\.$/, '')
}

function registrableDomainHeuristic(host: string) {
  const h = normalizeHost(host)
  const parts = h.split('.').filter(Boolean)
  if (parts.length <= 1) return h
  const tail2 = parts.slice(-2).join('.')
  const secondLevel = parts[parts.length - 2]
  const ccSecondLevels = new Set(['ac', 'co', 'com', 'edu', 'gov', 'net', 'org'])
  if (ccSecondLevels.has(String(secondLevel || '')) && parts.length >= 3) return parts.slice(-3).join('.')
  return tail2
}

function isHostSuffixMatch(host: string, suffix: string) {
  const h = normalizeHost(host)
  const s = normalizeHost(suffix)
  if (!h || !s) return false
  return h === s || h.endsWith(`.${s}`)
}

function normalizeIntent(intentRaw: string) {
  const s = String(intentRaw || '').trim().toLowerCase()
  if (!s) return ''
  return intentAliasMap[s] || s
}

export function scoreCandidateForIntent(c: any, intentRaw: string) {
  const intent = normalizeIntent(intentRaw)
  if (!intent) return -999
  const kind = String(c?.kind || '').toLowerCase()
  const role = String(c?.role || '').toLowerCase()
  const tag = String(c?.tag || '').toUpperCase()
  const label = String(c?.label || '').replace(/\s+/g, ' ').trim()
  const aria = String(c?.ariaLabel || '').replace(/\s+/g, ' ').trim()
  const title = String(c?.title || '').replace(/\s+/g, ' ').trim()
  const ph = String(c?.placeholder || '').replace(/\s+/g, ' ').trim()
  const href = String(c?.href || '').trim()
  const text = `${label} ${aria} ${title} ${ph}`.toLowerCase()
  const isButtonish = kind === 'button' || role === 'button' || tag === 'BUTTON' || /button/.test(role)
  const isLinkish = kind === 'link' || role === 'link' || tag === 'A' || /link/.test(role)
  const isInputish = kind === 'input' || /textbox|searchbox|combobox|input/.test(role) || tag === 'INPUT' || tag === 'TEXTAREA'

  let sVal = 0
  if (isButtonish) sVal += globalIntentScoring.base.isButtonish
  if (isLinkish) sVal += globalIntentScoring.base.isLinkish
  if (isInputish) sVal += globalIntentScoring.base.isInputish
  if (text.length > 0) sVal += globalIntentScoring.base.hasAnyText

  if (globalIntentScoring.badLabelRe.test(label)) sVal += globalIntentScoring.badLabelPenalty
  const rule = intentScoreRules[intent]
  if (!rule) return -999

  const flags = { isButtonish, isLinkish, isInputish }
  const targetText = (target: CandidateTarget) => {
    if (target === 'text') return text
    if (target === 'label') return label
    return href
  }

  for (const cond of rule.conditions as CandidateCondition[]) {
    if (cond.requires?.length) {
      const ok = cond.requires.every((f) => (flags as any)[f])
      if (!ok) continue
    }

    if (cond.kind === 'matchAny') {
      const t = targetText(cond.target)
      if (cond.patterns.some((re) => re.test(t))) sVal += cond.delta
    } else if (cond.kind === 'primaryMatchAny') {
      const t = targetText(cond.target)
      const matched = cond.patterns.some((re) => re.test(t))
      sVal += matched ? cond.matchDelta : cond.noMatchDelta
    } else if (cond.kind === 'flag') {
      if ((flags as any)[cond.flag]) sVal += cond.delta
    } else if (cond.kind === 'flagAny') {
      if (cond.flags.some((f) => (flags as any)[f])) sVal += cond.delta
    } else if (cond.kind === 'labelLenGte') {
      if (label.length >= cond.min) sVal += cond.delta
    } else if (cond.kind === 'labelLenGteAndNotMatchAny') {
      if (label.length >= cond.min) {
        const t = targetText(cond.target)
        const matched = cond.patterns.some((re) => re.test(t))
        if (!matched) sVal += cond.delta
      }
    }
  }

  if (globalIntentScoring.adLabelRe.test(label)) sVal += globalIntentScoring.adLabelPenalty
  if (!label && !aria && !title) sVal += globalIntentScoring.emptyTextPenalty
  return sVal
}

export function pickCandidateIndexByIntent(candidates: any[], intent: string) {
  const list = Array.isArray(candidates) ? candidates.map((x) => x || {}) : []
  let best = { idx: -1, score: -999 }
  for (let i = 0; i < list.length; i++) {
    const c = list[i]
    const sc = scoreCandidateForIntent(c, intent)
    if (sc > best.score) best = { idx: i, score: sc }
  }
  if (best.idx < 0) return -1
  if (best.score < globalIntentScoring.pickMinScore) return -1
  return best.idx
}

export function rankedCandidateIndexesByIntent(candidates: any[], intent: string) {
  const list = Array.isArray(candidates) ? candidates.map((x) => x || {}) : []
  const scored = list.map((c, idx) => ({ idx, score: scoreCandidateForIntent(c, intent), c }))
  scored.sort((a, b) => b.score - a.score)
  return scored.filter((x) => x.score >= globalIntentScoring.pickMinScore).map((x) => x.idx)
}

export function pickGenericFirstResultCandidateIndex(candidates: any[]) {
  const list = Array.isArray(candidates) ? candidates.map((x) => x || {}) : []
  let best = { idx: -1, score: -999 }
  for (let i = 0; i < list.length; i++) {
    const c = list[i]
    const kind = String(c?.kind || '').toLowerCase()
    const role = String(c?.role || '').toLowerCase()
    const label = String(c?.label || '').replace(/\s+/g, ' ').trim()
    const aria = String(c?.ariaLabel || '').replace(/\s+/g, ' ').trim()
    const title = String(c?.title || '').replace(/\s+/g, ' ').trim()
    const context = String(c?.contextText || c?.context || '').replace(/\s+/g, ' ').trim()
    const href = String(c?.href || '').trim()
    const text = `${label} ${aria} ${title} ${context}`.replace(/\s+/g, ' ').trim()
    if (!label && !href) continue
    if (genericFirstResultConfig.dangerousRe.test(text)) continue
    if (genericFirstResultConfig.badLabelRe.test(text)) continue
    if (href && genericFirstResultConfig.badHrefRe.test(href)) continue
    if (genericFirstResultConfig.blackboardSkipRe.test(href)) continue
    const isLinkish = kind === 'link' || role === 'link' || /link/.test(role) || !!href
    if (!isLinkish) continue
    const b = c?.bbox
    const y = Number(b?.y)
    const x = Number(b?.x)
    let s = 0
    if (genericFirstResultConfig.goodLabelRe.test(text)) s += 18
    if (/\b(详情|进入|查看|打开|继续|read more|more)\b/i.test(text)) s += 8
    if (href && /\/(detail|item|product|post|article|news|video|watch)\b/i.test(href)) s += 14
    if (href && /^https?:\/\//i.test(href)) s += 4
    if (label.length >= 4) s += 2
    if (context && /(卡片|列表|内容|标题|作者|播放|评论|阅读|视频|文章|商品)/i.test(context)) s += 4
    if (context && /(广告|赞助|推荐|更多|分享|反馈|举报|下载|打开app)/i.test(context)) s -= 8
    if (Number.isFinite(y)) s += Math.max(0, 800 - y) / 80
    if (Number.isFinite(x)) s += Math.max(0, 400 - x) / 160
    if (s > best.score) best = { idx: i, score: s }
  }
  if (best.idx < 0) return -1
  if (best.score < pickThreshold.genericFirst.minScore) return -1
  return best.idx
}

export function inferDetailLinkCandidates(candidates: any[], baseUrl: string) {
  const list = Array.isArray(candidates) ? candidates.map((x) => x || {}) : []
  const base = (() => {
    try {
      return new URL(String(baseUrl || ''))
    } catch {
      return null
    }
  })()
  const baseHost = base ? normalizeHost(base.hostname) : ''
  const baseDomain = baseHost ? registrableDomainHeuristic(baseHost) : ''
  const out: Array<{ url: string; idx: number; score: number }> = []
  for (let i = 0; i < list.length; i++) {
    const c = list[i]
    const href = String(c?.href || '').trim()
    if (!href || !/^https?:\/\//i.test(href)) continue
    let u: URL | null = null
    try {
      u = new URL(href)
    } catch {
      u = null
    }
    if (!u) continue
    const host = normalizeHost(u.hostname)
    if (baseDomain && !isHostSuffixMatch(host, baseDomain)) continue
    const path = String(u.pathname || '')
    if (!detailLinkConfig.videoPathRe.test(path) && !detailLinkConfig.detailishPathRe.test(path)) continue
    if (detailLinkConfig.blackboardSkipRe.test(path)) continue
    if (detailLinkConfig.badPathRe.test(path)) continue
    const label = String(c?.label || '').replace(/\s+/g, ' ').trim()
    let s = 0
    if (detailLinkConfig.videoPathRe.test(path)) s += detailLinkConfig.pathBoost.video
    else s += detailLinkConfig.pathBoost.other
    if (label && label.length >= 6) s += detailLinkConfig.labelLenBoost.min6
    if (label && label.length >= 12) s += detailLinkConfig.labelLenBoost.min12
    if (label && detailLinkConfig.badLabelRe.test(label)) s += detailLinkConfig.labelLenBoost.badLabelPenalty
    const b = c?.bbox
    const y = Number(b?.y)
    const x = Number(b?.x)
    if (Number.isFinite(y)) s += Math.max(0, detailLinkConfig.bbox.y1Base - y) / detailLinkConfig.bbox.y1Div
    if (Number.isFinite(x)) s += Math.max(0, detailLinkConfig.bbox.x1Base - x) / detailLinkConfig.bbox.x1Div
    out.push({ url: u.toString(), idx: i, score: s })
  }
  out.sort((a, b) => b.score - a.score)
  return out
}
