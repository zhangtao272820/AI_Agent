export type IntentCall =
  | { intent: 'goto'; args: { url: string }; reason?: string }
  | { intent: 'search'; args: { query: string }; reason?: string }
  | { intent: 'open_first_result'; reason?: string }
  | { intent: 'scroll'; args?: { dy?: number }; reason?: string }
  | { intent: 'wait'; args: { ms: number }; reason?: string }
  | { intent: 'paginate_next'; reason?: string }
  | { intent: 'extract_items'; args?: { limit?: number }; reason?: string }
  | { intent: 'play'; reason?: string }
  | { intent: 'like'; reason?: string }
  | { intent: 'coin'; reason?: string }
  | { intent: 'follow'; reason?: string }
  | { intent: 'favorite'; reason?: string }
  | { intent: 'click_by_bbox'; args: { index: number }; reason?: string }
  | { intent: 'click_by_text'; args: { text: string }; reason?: string }
  | { intent: 'dismiss_overlays'; reason?: string }
  | { intent: 'reload'; reason?: string }
  | { intent: 'back'; reason?: string }
  | { intent: 'need_crawl'; reason?: string }
  | { intent: 'done'; reason?: string }

export type ForcedKey =
  | 'stall'
  | 'no_effect.dismiss_overlays'
  | 'no_effect.goto'
  | 'no_effect.search'
  | 'no_effect.open_first_result'
  | 'no_effect.paginate_next'
  | 'no_effect.play_from_search'
  | 'no_effect.click_candidate_nav'
  | 'no_effect.type_submit'
  | 'recover.blocked_by_overlay'
  | 'recover.no_effect.generic'
  | 'recover.no_effect.open_first_result'
  | 'recover.no_effect.search'
  | 'recover.timeout'
  | 'recover.selector_not_found'
  | 'recover.detached'
  | 'recover.not_visible'

type AnyParams = Record<string, any>

const filterRisky = (seq: IntentCall[], p: AnyParams) => {
  const allowRisky = !!p.allowRiskyRecoveryClicks
  if (allowRisky) return seq
  const risky = new Set(['click_by_text', 'click_by_bbox'])
  return (Array.isArray(seq) ? seq : []).filter((x) => !risky.has(String((x as any)?.intent || '').trim()))
}

const overlayLikelyFromHint = (hint: string) => {
  const s = String(hint || '')
  return /弹窗|对话框|遮罩|蒙层|同意|允许|继续|我知道了|知道了|cookie|隐私|协议|登录/i.test(s)
}

const registry: Record<ForcedKey, (p: AnyParams) => IntentCall[]> = {
  stall: (p) => {
    const overlayLikely = overlayLikelyFromHint(String(p.hint || ''))
    const seq: IntentCall[] = [{ intent: 'dismiss_overlays', reason: '停滞恢复：先关闭遮罩/弹窗' }]
    if (overlayLikely) seq.push({ intent: 'click_by_text', args: { text: '关闭' }, reason: '停滞恢复：尝试按文字关闭弹窗' })
    seq.push(
      { intent: 'scroll', args: { dy: 800 }, reason: '停滞恢复：滚动换策略' },
      { intent: 'reload', reason: '停滞恢复：刷新页面' },
      { intent: 'back', reason: '停滞恢复：回退到上一步' }
    )
    return seq
  },
  'no_effect.dismiss_overlays': () => [
    { intent: 'scroll', args: { dy: 700 }, reason: '无效果恢复：关闭弹窗未生效，先滚动换布局' },
    { intent: 'reload', reason: '无效果恢复：刷新页面' },
    { intent: 'back', reason: '无效果恢复：回退' }
  ],
  'no_effect.goto': () => [
    { intent: 'dismiss_overlays', reason: '无效果恢复：先关闭遮罩/弹窗' },
    { intent: 'reload', reason: '无效果恢复：刷新页面' },
    { intent: 'back', reason: '无效果恢复：回退' }
  ],
  'no_effect.search': (p) => {
    const q = String(p.query || '').trim() || 'LangGraph'
    return [
      { intent: 'dismiss_overlays', reason: '无效果恢复：先关闭遮罩/弹窗' },
      { intent: 'reload', reason: '无效果恢复：刷新页面' },
      { intent: 'search', args: { query: q }, reason: '无效果恢复：重新搜索' }
    ]
  },
  'no_effect.open_first_result': (p) => {
    const idx = Number(p.entryIndex ?? -1)
    const adapterKey = String(p.adapterKey || '').trim().toLowerCase()
    const seq: IntentCall[] = [
      { intent: 'dismiss_overlays', reason: '无效果恢复：先关闭遮罩/弹窗' },
      { intent: 'scroll', args: { dy: 900 }, reason: '无效果恢复：滚动换一批入口' },
      { intent: 'open_first_result', reason: '无效果恢复：再次进入第一个结果' },
      { intent: 'reload', reason: '无效果恢复：刷新页面' },
      { intent: 'back', reason: '无效果恢复：回退' }
    ]
    if (Number.isFinite(idx) && idx >= 0) {
      seq.splice(2, 0, { intent: 'click_by_text', args: { text: '详情' }, reason: '无效果恢复：谨慎尝试按文字进入详情' })
      seq.push({ intent: 'click_by_bbox', args: { index: idx }, reason: `无效果恢复：最后兜底使用 bbox 点击入口（index=${idx}）` })
    }
    return seq
  },
  'no_effect.paginate_next': (p) => {
    const idx = Number(p.nextIndex ?? -1)
    const seq: IntentCall[] = [
      { intent: 'dismiss_overlays', reason: '无效果恢复：先关闭遮罩/弹窗' },
      { intent: 'scroll', args: { dy: 900 }, reason: '无效果恢复：滚动寻找翻页入口' },
      { intent: 'paginate_next', reason: '无效果恢复：再次翻页' },
      { intent: 'click_by_text', args: { text: '下一页' }, reason: '无效果恢复：最后才按文字翻页' }
    ]
    if (Number.isFinite(idx) && idx >= 0) {
      seq.push({ intent: 'click_by_bbox', args: { index: idx }, reason: `无效果恢复：最后兜底点击下一页（bbox index=${idx}）` })
    }
    return seq
  },
  'no_effect.play_from_search': () => [
    { intent: 'dismiss_overlays', reason: '无效果恢复：先关闭遮罩/弹窗' },
    { intent: 'scroll', args: { dy: 900 }, reason: '无效果恢复：滚动换一批候选' },
    { intent: 'open_first_result', reason: '无效果恢复：重新进入第一个结果' }
  ],
  'no_effect.click_candidate_nav': (p) => {
    const idx = Number(p.index ?? -1)
    const seq: IntentCall[] = [
      { intent: 'dismiss_overlays', reason: '无效果恢复：先关闭遮罩/弹窗' },
      { intent: 'scroll', args: { dy: 800 }, reason: '无效果恢复：滚动换策略' },
      { intent: 'open_first_result', reason: '无效果恢复：换入口进入结果' }
    ]
    if (Number.isFinite(idx) && idx >= 0) {
      seq.push({ intent: 'click_by_bbox', args: { index: idx }, reason: `无效果恢复：最后兜底才用 bbox 点击同一候选（index=${idx}）` })
    }
    return seq
  },
  'no_effect.type_submit': (p) => {
    const q = String(p.query || '').trim() || 'LangGraph'
    return [
      { intent: 'dismiss_overlays', reason: '无效果恢复：先关闭遮罩/弹窗' },
      { intent: 'search', args: { query: q }, reason: '无效果恢复：重新执行搜索' }
    ]
  },
  'recover.blocked_by_overlay': (p) => {
    const closeIdx = Number(p.closeIndex ?? -1)
    const seq: IntentCall[] = [
      { intent: 'dismiss_overlays', reason: '异常恢复：遮罩拦截，先关闭弹窗/遮罩' },
      { intent: 'click_by_text', args: { text: '关闭' }, reason: '异常恢复：按文字点击关闭' },
      { intent: 'reload', reason: '异常恢复：刷新页面' }
    ]
    if (Number.isFinite(closeIdx) && closeIdx >= 0) {
      seq.push({ intent: 'click_by_bbox', args: { index: closeIdx }, reason: '异常恢复：最后兜底使用 bbox 点击关闭按钮' })
    }
    return seq
  },
  'recover.no_effect.generic': () => [
    { intent: 'dismiss_overlays', reason: '异常恢复：无效果，先关闭弹窗/遮罩' },
    { intent: 'reload', reason: '异常恢复：刷新页面' }
  ],
  'recover.no_effect.open_first_result': (p) => {
    const idx = Number(p.entryIndex ?? -1)
    const adapterKey = String(p.adapterKey || '').trim().toLowerCase()
    const seq: IntentCall[] = [
      { intent: 'dismiss_overlays', reason: '异常恢复：无效果，先关闭弹窗/遮罩' },
      { intent: 'scroll', args: { dy: 800 }, reason: '异常恢复：滚动换一批入口' },
      { intent: 'open_first_result', reason: '异常恢复：再次进入第一个结果' }
    ]
    if (Number.isFinite(idx) && idx >= 0) {
      seq.push({ intent: 'click_by_text', args: { text: '详情' }, reason: '异常恢复：谨慎按文字进入详情' })
      seq.push({ intent: 'click_by_bbox', args: { index: idx }, reason: '异常恢复：最后兜底点击可能的入口（bbox）' })
    }
    return seq
  },
  'recover.no_effect.search': (p) => {
    const q = String(p.query || '').trim() || 'LangGraph'
    return [
      { intent: 'dismiss_overlays', reason: '异常恢复：无效果，先关闭弹窗/遮罩' },
      { intent: 'click_by_text', args: { text: '搜索' }, reason: '异常恢复：尝试按文字聚焦搜索入口' },
      { intent: 'search', args: { query: q }, reason: '异常恢复：重新搜索' }
    ]
  },
  'recover.timeout': () => [
    { intent: 'dismiss_overlays', reason: '异常恢复：超时，先关闭弹窗/遮罩' },
    { intent: 'reload', reason: '异常恢复：刷新页面' }
  ],
  'recover.selector_not_found': () => [{ intent: 'reload', reason: '异常恢复：定位失败，刷新页面' }],
  'recover.detached': () => [{ intent: 'reload', reason: '异常恢复：定位失败，刷新页面' }],
  'recover.not_visible': () => [{ intent: 'scroll', args: { dy: 700 }, reason: '异常恢复：元素不可见，先滚动' }]
}

export function getForcedIntents(key: ForcedKey, params: AnyParams = {}): IntentCall[] {
  const fn = registry[key]
  const raw = fn ? fn(params) : []
  return filterRisky(raw, params)
}
