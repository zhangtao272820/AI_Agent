/** 从任务文案推断登录意图（避免「不触发登录」被误判为 needsLogin） */

const AVOID_LOGIN_RE = /不(?:要|用|需|必|去|触发|进行)?\s*登录|无需登录|免登录|不登录|游客(?:模式|浏览)?/i

export function taskExplicitlyAvoidsLogin(task: string): boolean {
  return AVOID_LOGIN_RE.test(String(task || ''))
}

export function isBilibiliHost(urlOrHost: string): boolean {
  return /bilibili\.com|b23\.tv/i.test(String(urlOrHost || ''))
}

export function taskRequiresLogin(task: string, startUrl?: string): boolean {
  const t = String(task || '')
  if (taskExplicitlyAvoidsLogin(t)) return false
  if (/需要登录|必须登录|请先登录|登录后|要求登录|sign\s*in\s*required|must\s*log\s*in/i.test(t)) return true
  const start = String(startUrl || '')
  if (/\/login\b/i.test(start)) return true
  const stripped = t.replace(/不(?:要|用|需|必|去|触发|进行)?\s*登录/gi, '')
  if (/登录|登陆|sign\s*in|log\s*in/i.test(stripped)) return true
  return false
}

export function bilibiliSearchUrl(query: string): string {
  const q = String(query || '').trim() || 'test'
  return `https://search.bilibili.com/all?keyword=${encodeURIComponent(q)}`
}

/** 当前页是否仍需跳转到 B 站搜索页（首页/弹窗态） */
export function bilibiliNeedsDirectSearch(pageUrl: string): boolean {
  const u = String(pageUrl || '')
  if (!isBilibiliHost(u)) return false
  if (/search\.bilibili\.com/i.test(u)) return false
  if (/\/video\/(BV[\w]+|av\d+)/i.test(u)) return false
  return true
}

export function bilibiliDirectSearchIntent(query: string, reason = 'B站直达搜索页') {
  return { intent: 'goto', args: { url: bilibiliSearchUrl(query) }, reason }
}

export function isBaiduHost(urlOrHost: string): boolean {
  return /baidu\.com/i.test(String(urlOrHost || ''))
}

export function baiduSearchUrl(query: string): string {
  const q = String(query || '').trim() || 'test'
  return `https://www.baidu.com/s?wd=${encodeURIComponent(q)}`
}

/** 当前页尚未进入百度搜索结果态时，应直达 /s?wd= */
export function baiduNeedsDirectSearch(pageUrl: string): boolean {
  const u = String(pageUrl || '')
  if (!isBaiduHost(u)) return false
  if (/[?&]wd=/i.test(u) || /\/s(\?|$)/i.test(u)) return false
  return true
}

export function baiduDirectSearchIntent(query: string, reason = '百度直达搜索结果页') {
  return { intent: 'goto', args: { url: baiduSearchUrl(query) }, reason }
}

/** B 站游客任务：登录推广弹窗不应阻塞搜索主线 */
export function isBilibiliGuestTask(state: { task?: string; pageUrl?: string; plan?: any; startUrl?: string }): boolean {
  const url = String(state.pageUrl || state.plan?.startUrl || state.startUrl || '')
  if (!isBilibiliHost(url) && !isBilibiliHost(String(state.task || ''))) return false
  if (taskExplicitlyAvoidsLogin(String(state.task || ''))) return true
  if (!taskRequiresLogin(String(state.task || ''), url) && !(state.plan as any)?.needsLogin) return true
  return false
}
