import { isBilibiliGuestTask } from './taskLoginIntent'

type AnyObj = Record<string, any>

type Action =
  | { type: 'goto'; url: string; reason?: string }
  | { type: 'click'; selector: string; reason?: string }
  | { type: 'click_candidate'; index: number; reason?: string }
  | { type: 'click_by_bbox'; index: number; reason?: string }
  | { type: 'click_by_text'; text: string; reason?: string }
  | { type: 'type'; selector?: string; text: string; reason?: string }
  | { type: 'type_candidate'; index: number; text: string; reason?: string }
  | { type: 'scroll'; dy?: number; reason?: string }
  | { type: 'wait'; ms?: number; reason?: string }
  | { type: 'ensure_play'; reason?: string }
  | { type: 'extract'; fields?: string[]; limit?: number; reason?: string }
  | { type: 'dismiss_overlays'; reason?: string }
  | { type: 'reload'; reason?: string }
  | { type: 'back'; reason?: string }
  | { type: 'need_crawl'; reason?: string }
  | { type: 'done'; reason?: string }

export type GateInfo = {
  ts: number
  ok: boolean
  reason: string
  originalAction: AnyObj
  rewrittenAction?: AnyObj
  evidence?: AnyObj
}

const normalizeHost = (host: string) => String(host || '').trim().toLowerCase().replace(/\.$/, '')

const registrableDomainHeuristic = (host: string) => {
  const h = normalizeHost(host)
  const parts = h.split('.').filter(Boolean)
  if (parts.length <= 1) return h
  const tail2 = parts.slice(-2).join('.')
  const secondLevel = parts[parts.length - 2]
  const ccSecondLevels = new Set(['ac', 'co', 'com', 'edu', 'gov', 'net', 'org'])
  if (ccSecondLevels.has(String(secondLevel || '')) && parts.length >= 3) return parts.slice(-3).join('.')
  return tail2
}

const safeUrlHost = (url: string) => {
  try {
    return normalizeHost(new URL(String(url || '')).hostname)
  } catch {
    return ''
  }
}

const sameRegistrableDomain = (a: string, b: string) => {
  const ha = safeUrlHost(a)
  const hb = safeUrlHost(b)
  if (!ha || !hb) return false
  return registrableDomainHeuristic(ha) === registrableDomainHeuristic(hb)
}

const candidateHasClose = (candidatesAny: any) => {
  const list: any[] = Array.isArray(candidatesAny) ? candidatesAny : []
  const safeRe = /(关闭|关\s*闭|取消|我知道了|知道了|稍后|以后再说|skip|not now|dismiss|close)/i
  const dangerousRe = /(购买|支付|下单|提交订单|确认支付|删除|移除|退订|开通|订阅|充值)/i
  for (let i = 0; i < Math.min(60, list.length); i++) {
    const c = list[i] && typeof list[i] === 'object' ? list[i] : {}
    const label = String(c.label || '').replace(/\s+/g, ' ').trim()
    const aria = String(c.ariaLabel || '').replace(/\s+/g, ' ').trim()
    const title = String(c.title || '').replace(/\s+/g, ' ').trim()
    const text = `${label} ${aria} ${title}`.replace(/\s+/g, ' ').trim()
    if (!text) continue
    if (dangerousRe.test(text)) continue
    if (!safeRe.test(text)) continue
    const kind = String(c.kind || '').toLowerCase()
    if (kind === 'input') continue
    return true
  }
  return false
}

const looksOverlayLikely = (state: AnyObj) => {
  if (isBilibiliGuestTask(state)) {
    const vj = state.visionJson && typeof state.visionJson === 'object' ? state.visionJson : {}
    const pt = String((vj as any).pageType || '').toLowerCase()
    const summary = String((state as any).visionSummary || '')
    if (pt === 'login' || /登录|扫码|暂不登录|登录后/i.test(summary)) return false
  }
  const vj = state.visionJson && typeof state.visionJson === 'object' ? state.visionJson : {}
  if (typeof (vj as any).hasOverlay === 'boolean') return !!(vj as any).hasOverlay
  // 当视觉模型没有给出 overlay 结论时，仅在停滞且存在“可关闭候选”时触发保守预处理。
  const stall = Math.max(0, Math.floor(Number((state as any).stallCount || 0)))
  return stall >= 2 && candidateHasClose((state as any).candidates)
}

const looksVideoLike = (state: AnyObj) => {
  const vj = state.visionJson && typeof state.visionJson === 'object' ? state.visionJson : {}
  if (typeof (vj as any).hasPlayer === 'boolean' && (vj as any).hasPlayer) return true
  const url = String(state.pageUrl || '')
  if (/\/video\/[a-z0-9]+/i.test(url)) return true
  if (/music\.163\.com/i.test(url) && /#\/song\?|\/song\?/i.test(url)) return true
  if (String(state.pageText || '').includes('<video')) return true
  return false
}

/** 用于 watch/play 阶段：区分「播放器内操作」与「跳转到其他视频/空间」 */
function extractVideoIdKey(url: string): string {
  const s = String(url || '')
  if (/music\.163\.com/i.test(s)) {
    const m = s.match(/[?&#]id=(\d+)/)
    if (m?.[1] && /song/i.test(s)) return `n:${m[1]}`
  }
  const vm = s.match(/\/video\/(BV[\w]+|av\d+)/i)
  if (vm?.[1]) return `v:${vm[1].toLowerCase()}`
  return ''
}

const PLAYER_CHROME_RE =
  /(音量|静音|声\s*音|sound|vol|muted|播放|暂停|play|pause|开始|继续|全屏|退出全屏|宽屏|网页全屏|画中画|小窗|弹幕|弹\s*幕|开\s*启\s*弹\s*幕|关\s*闭\s*弹\s*幕|画质|清晰度|自动(\s*质量)?|1080|720|480|4\s*k|杜比|hdr|倍速|0\.\d+\s*x|[12](\.\d+)?\s*x|设置|字幕|\bcc\b|循环|列表|顺序|选集|歌词|下一首|上一首|红心|随机|单曲)/i
const ENGAGEMENT_RE = /(点赞|投币|收藏|关注|一键\s*三连|三\s*连|喜欢|\+关注)/i

function isWatchPlayLocalInteraction(state: AnyObj, action: Action): boolean {
  const task = String(state.task || '')

  if (action.type === 'click_by_bbox') return true

  if (action.type === 'click_by_text') {
    const text = String((action as any).text || '')
    return PLAYER_CHROME_RE.test(text) || ENGAGEMENT_RE.test(text) || (/(评论|弹幕|回复)/.test(task) && /(评论|回复|发送|弹幕)/.test(text))
  }

  if (action.type === 'scroll') {
    const dy = Math.abs(Number((action as any).dy ?? 0))
    return dy > 0 && dy <= 900
  }

  if (action.type === 'type' || action.type === 'type_candidate') {
    return /(评论|回复|弹幕|发表|发送)/.test(task)
  }

  if (action.type === 'click') {
    const r = String((action as any).reason || '')
    return /(播放|音量|画质|弹幕|全屏|倍速|进度)/.test(r) && /(播放|音量|画质|弹幕|全屏|倍速|进度)/.test(task)
  }

  if (action.type === 'click_candidate') {
    const idx = Math.max(0, Math.floor(Number((action as any).index ?? -1)))
    const list: any[] = Array.isArray(state.candidates) ? state.candidates : []
    const cand = list[idx]
    if (!cand || typeof cand !== 'object') return false
    const label = String((cand as any).label || '').trim()
    const aria = String((cand as any).ariaLabel || '').trim()
    const title = String((cand as any).title || '').trim()
    const href = String((cand as any).href || '').trim()
    const kind = String((cand as any).kind || '').toLowerCase()
    const role = String((cand as any).role || '').toLowerCase()
    const blob = `${label} ${aria} ${title}`

    if (PLAYER_CHROME_RE.test(blob) || ENGAGEMENT_RE.test(blob)) return true
    if (/(评论|弹幕)/.test(task) && /(评论|回复|发送|弹幕|输入|发表)/.test(blob)) return true

    const pageUrl = String(state.pageUrl || '')
    const hrefKey = extractVideoIdKey(href)
    const pageKey = extractVideoIdKey(pageUrl)
    if (hrefKey && pageKey && hrefKey !== pageKey) return false
    const sameVideoAnchor = !!(hrefKey && pageKey && hrefKey === pageKey)

    if (!href || href === '#' || /^javascript:/i.test(href)) {
      if (kind === 'button' || role.includes('button')) return true
    }

    // 任务明确要调播放器控件，且候选不是外链视频：允许无文案的控件（多为图标按钮/滑块）
    if (
      /(音量|静音|播放|暂停|画质|弹幕|倍速|全屏|投币|点赞|收藏|关注|歌词|红心|切歌|单曲)/.test(task) &&
      (kind !== 'link' || sameVideoAnchor) &&
      !(href && /^https?:\/\//i.test(href) && extractVideoIdKey(href) && pageKey && extractVideoIdKey(href) !== pageKey)
    ) {
      return true
    }

    return false
  }

  return false
}

export async function applyCompliance(params: {
  state: AnyObj
  action: Action
  page?: any
  detectVideoPlaybackStateDeep?: (page: any) => Promise<{ hasVideo: boolean; ended: boolean; currentTime: number; duration: number }>
}): Promise<{ action: Action; gate?: GateInfo }> {
  const state = params.state || {}
  const original = params.action as Action
  const action = original && typeof original === 'object' ? (original as Action) : ({ type: 'wait', ms: 200 } as Action)
  const now = Date.now()

  const stage = String(state.stage || '')
  const lastKey = String(state.lastActionKey || '')
  const sameActionCount = Math.max(0, Math.floor(Number(state.sameActionCount || 0)))

  const constraints =
    state.taskSpec?.summary?.constraints && typeof state.taskSpec.summary.constraints === 'object' ? state.taskSpec.summary.constraints : {}
  const forbidExternal = !!(constraints as any).noExternal
  if (forbidExternal) {
    const baseUrl = String(state.pageUrl || state.listUrl || state.plan?.startUrl || state.startUrl || '')
    if (action.type === 'goto') {
      const target = String((action as any).url || '').trim()
      if (target && baseUrl && !sameRegistrableDomain(baseUrl, target)) {
        const gate: GateInfo = {
          ts: now,
          ok: false,
          reason: 'forbid_external_domain',
          originalAction: original as any,
          rewrittenAction: { type: 'wait', ms: 400, reason: 'gate:forbid_external_domain（已阻止外站跳转）' },
          evidence: { baseUrl, target }
        }
        return { action: gate.rewrittenAction as any, gate }
      }
    }
    if (action.type === 'click_candidate') {
      const idx = Math.max(0, Math.floor(Number((action as any).index ?? -1)))
      const cand = Array.isArray(state.candidates) ? state.candidates[idx] : null
      const href = cand && typeof cand === 'object' ? String((cand as any).href || '').trim() : ''
      const baseUrl = String(state.pageUrl || state.listUrl || state.plan?.startUrl || state.startUrl || '')
      if (href && baseUrl && /^https?:\/\//i.test(href) && !sameRegistrableDomain(baseUrl, href)) {
        const gate: GateInfo = {
          ts: now,
          ok: false,
          reason: 'forbid_external_domain',
          originalAction: original as any,
          rewrittenAction: { type: 'wait', ms: 400, reason: 'gate:forbid_external_domain（已阻止外站点击）' },
          evidence: { baseUrl, href }
        }
        return { action: gate.rewrittenAction as any, gate }
      }
    }
  }

  const overlayLikely = looksOverlayLikely(state)
  const bilibiliGuest = isBilibiliGuestTask(state)
  const dismissExhausted = lastKey === 'dismiss_overlays' && sameActionCount >= 2
  const searchDespiteOverlay =
    bilibiliGuest &&
    (stage === 'search' || !stage) &&
    ['goto', 'type', 'type_candidate', 'click_candidate'].includes(action.type) &&
    (/搜索|search/i.test(String((action as any).reason || '')) ||
      /search\.bilibili\.com/i.test(String((action as any).url || '')))
  if (overlayLikely && action.type !== 'dismiss_overlays') {
    const onVideoPage = looksVideoLike(state)
    const actionIsVideoPrimary =
      ['ensure_play', 'wait', 'done'].includes(action.type) || (onVideoPage && isWatchPlayLocalInteraction(state, action))
    const alreadyTried = lastKey === 'dismiss_overlays' && sameActionCount >= 1
    if (!alreadyTried && !(onVideoPage && actionIsVideoPrimary) && !searchDespiteOverlay && !(bilibiliGuest && dismissExhausted)) {
      const gate: GateInfo = {
        ts: now,
        ok: false,
        reason: 'overlay_likely',
        originalAction: original as any,
        rewrittenAction: { type: 'dismiss_overlays', reason: `gate:overlay_likely（预处理：${String(action.type)}）` }
      }
      return { action: gate.rewrittenAction as any, gate }
    }
  }

  const watchRecoveryReason = String((action as any)?.reason || '')
  const isWatchRecoveryNav =
    (action.type === 'goto' || action.type === 'back') && /观看守卫|回到首次进入的视频|回到目标视频/i.test(watchRecoveryReason)
  if (
    (stage === 'watch' || stage === 'play') &&
    !['wait', 'ensure_play', 'dismiss_overlays', 'reload', 'back', 'done'].includes(action.type) &&
    !isWatchPlayLocalInteraction(state, action) &&
    !isWatchRecoveryNav
  ) {
    const gate: GateInfo = {
      ts: now,
      ok: false,
      reason: 'stage_guard',
      originalAction: original as any,
      rewrittenAction: { type: 'wait', ms: 800, reason: 'gate:stage_guard（观看阶段限制动作）' },
      evidence: { stage }
    }
    return { action: gate.rewrittenAction as any, gate }
  }

  if (action.type === 'done') {
    const watchSeconds = Math.max(0, Math.floor(Number(state.watchSeconds || 0))) || Math.max(0, Math.floor(Number(state.taskSpec?.completionCriteria?.watchSeconds || 0)))
    const wantsTimedWatch = watchSeconds > 0
    const untilAt = Math.max(0, Math.floor(Number(state.watchUntilAt || 0)))
    if (wantsTimedWatch) {
      const deadline = untilAt > 0 ? untilAt : 0
      if (deadline > 0 && now < deadline) {
        const remaining = Math.max(200, Math.min(120000, deadline - now))
        const gate: GateInfo = {
          ts: now,
          ok: false,
          reason: 'watch_seconds_not_met',
          originalAction: original as any,
          rewrittenAction: { type: 'wait', ms: remaining, reason: 'gate:watch_seconds_not_met（观看计时中，禁止提前结束）' },
          evidence: { watchSeconds, remainingMs: remaining, watchUntilAt: deadline }
        }
        return { action: gate.rewrittenAction as any, gate }
      }
      if (deadline === 0 && looksVideoLike(state)) {
        const gate: GateInfo = {
          ts: now,
          ok: false,
          reason: 'watch_seconds_not_started',
          originalAction: original as any,
          rewrittenAction: { type: 'ensure_play', reason: 'gate:watch_seconds_not_started（先开始播放再计时）' },
          evidence: { watchSeconds }
        }
        return { action: gate.rewrittenAction as any, gate }
      }
    }

    const needWaitEnd = !!state.waitForVideoEnd || !!state.taskSpec?.completionCriteria?.waitForVideoEnd
    if (needWaitEnd && looksVideoLike(state)) {
      const page = params.page
      const detector = params.detectVideoPlaybackStateDeep
      const st = page && detector ? await detector(page).catch(() => null as any) : null
      const ended =
        !!st?.hasVideo &&
        (!!st.ended || (Number.isFinite(st.duration) && st.duration > 0 && Number.isFinite(st.currentTime) && st.currentTime >= st.duration - 0.4))
      if (!ended) {
        const gate: GateInfo = {
          ts: now,
          ok: false,
          reason: 'wait_for_video_end_not_met',
          originalAction: original as any,
          rewrittenAction: { type: 'wait', ms: 1000, reason: 'gate:wait_for_video_end_not_met（任务要求看完再关）' },
          evidence: st && typeof st === 'object' ? { hasVideo: !!st.hasVideo, currentTime: st.currentTime, duration: st.duration, ended: !!st.ended } : { hasVideo: false }
        }
        return { action: gate.rewrittenAction as any, gate }
      }
    }
  }

  return { action }
}
