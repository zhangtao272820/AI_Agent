/** 站点内流程阶段（通用 SPA 状态机） */
export type PageStage = 'home' | 'search' | 'list' | 'detail' | 'play' | 'history' | 'login' | 'captcha' | 'unknown'

export function normalizePageStage(stage: any): PageStage {
  const s = String(stage || '').trim().toLowerCase()
  if (s === 'captcha' || s === 'login' || s === 'search' || s === 'list' || s === 'detail' || s === 'play' || s === 'history' || s === 'home') return s
  return 'unknown'
}

export function stageTransitionAllowed(stageFrom: PageStage, stageTo: PageStage) {
  if (stageFrom === 'unknown' || stageFrom === stageTo) return true
  const allowed: Record<PageStage, PageStage[]> = {
    captcha: ['login', 'home', 'search', 'list', 'detail', 'play', 'history', 'unknown'],
    login: ['home', 'search', 'list', 'detail', 'play', 'history', 'unknown'],
    home: ['search', 'list', 'detail', 'play', 'history', 'unknown'],
    search: ['list', 'detail', 'play', 'history', 'unknown'],
    list: ['detail', 'play', 'history', 'unknown'],
    detail: ['play', 'list', 'history', 'unknown'],
    play: ['detail', 'list', 'history', 'unknown'],
    history: ['detail', 'play', 'list', 'unknown'],
    unknown: ['home', 'search', 'list', 'detail', 'play', 'history', 'login', 'captcha']
  }
  return (allowed[stageFrom] || []).includes(stageTo)
}

export function stageAllowsIntent(stage: PageStage, intent: string) {
  const it = String(intent || '').trim()
  if (!it) return false
  if (stage === 'captcha') return ['wait', 'dismiss_overlays', 'reload'].includes(it)
  if (stage === 'login') return ['wait', 'goto', 'reload', 'back', 'dismiss_overlays'].includes(it)
  // search 未完成前禁止 open_first_result，避免首页锚点误点频道（如 news.baidu.com）
  if (stage === 'search')
    return ['goto', 'search', 'scroll', 'wait', 'dismiss_overlays', 'reload', 'back', 'click_by_text', 'click_candidate', 'click_by_bbox', 'done'].includes(it)
  if (stage === 'list')
    return ['goto', 'open_first_result', 'scroll', 'wait', 'paginate_next', 'dismiss_overlays', 'reload', 'back', 'click_by_text', 'click_candidate', 'click_by_bbox', 'done'].includes(it)
  if (stage === 'detail')
    return ['goto', 'ensure_play', 'play', 'perform', 'wait', 'dismiss_overlays', 'reload', 'back', 'click_by_text', 'click_candidate', 'click_by_bbox', 'done'].includes(it)
  if (stage === 'play')
    return ['goto', 'ensure_play', 'wait', 'perform', 'dismiss_overlays', 'click_by_text', 'click_candidate', 'click_by_bbox', 'done'].includes(it)
  if (stage === 'history')
    return ['goto', 'extract_items', 'scroll', 'wait', 'paginate_next', 'dismiss_overlays', 'reload', 'back', 'click_by_text', 'click_candidate', 'click_by_bbox', 'done'].includes(it)
  if (stage === 'home')
    return ['goto', 'search', 'open_first_result', 'scroll', 'wait', 'dismiss_overlays', 'reload', 'back', 'click_by_text', 'click_candidate', 'click_by_bbox', 'done'].includes(it)
  return true
}

export function stagePrefersIntent(stage: PageStage, intent: string) {
  const it = String(intent || '').trim()
  if (!it) return false
  if (stage === 'captcha') return it === 'wait' || it === 'dismiss_overlays'
  if (stage === 'login') return it === 'wait' || it === 'goto'
  if (stage === 'search') return it === 'search'
  if (stage === 'list') return it === 'open_first_result' || it === 'paginate_next'
  if (stage === 'detail') return it === 'ensure_play' || it === 'play' || it === 'perform'
  if (stage === 'play') return it === 'ensure_play' || it === 'wait'
  if (stage === 'history') return it === 'extract_items'
  return false
}
