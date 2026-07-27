/**
 * 爬虫失败时结构性建议总管改路由 gui（Lobster）；不参与生产路由决策，仅输出 failure tag。
 */

export type CrawlerRouteSuggestion = 'gui' | null

export type CrawlerRouteInput = {
  status?: string
  clarifyReason?: string
  itemCount?: number
  stats?: Record<string, unknown>
  taskPlan?: { needsLogin?: boolean; preferredChannel?: string }
  lastError?: string
  failureTags?: string[]
  planNeedsLogin?: boolean
}

function includesAny(haystack: string, needles: readonly string[]): boolean {
  const s = String(haystack ?? '').toLowerCase()
  return needles.some((n) => s.includes(n.toLowerCase()))
}

export function inferCrawlerFailureTags(input: CrawlerRouteInput): string[] {
  const tags: string[] = []
  const status = String(input.status ?? '').toLowerCase()
  const reason = String(input.clarifyReason ?? '').toLowerCase()
  const err = String(input.lastError ?? '').toLowerCase()
  const stats = input.stats ?? {}
  const routeLog = String((stats as any)._routeLog ?? (stats as any).routeLog ?? '').toLowerCase()
  const blob = `${err} ${routeLog}`

  if (input.planNeedsLogin || input.taskPlan?.needsLogin) tags.push('login_required')
  if (reason.includes('login') || includesAny(blob, ['unauthorized', '401', 'sign in', 'signin', 'auth_required'])) {
    tags.push('login_required')
  }
  if (includesAny(err, ['captcha', '验证码', '人机验证', 'captcha_or_block'])) tags.push('captcha')
  if (includesAny(blob, ['403', 'forbidden', 'blocked', 'cloudflare', '拦截', 'captcha_or_block'])) {
    tags.push('access_blocked')
  }
  if (includesAny(blob, ['spa', 'javascript', 'render', 'empty dom', 'no items', '0 items'])) {
    tags.push('spa_or_js')
  }
  if (status === 'error' || status === 'failed') tags.push('execution_failed')
  if (
    (input.itemCount ?? 0) === 0 &&
    (input.taskPlan?.preferredChannel === 'browser' || routeLog.includes('browser'))
  ) {
    tags.push('browser_empty')
  }
  for (const t of input.failureTags ?? []) {
    const x = String(t ?? '').trim()
    if (x) tags.push(x)
  }
  return [...new Set(tags)]
}

export function inferCrawlerRouteSuggestion(input: CrawlerRouteInput): CrawlerRouteSuggestion {
  const tags = inferCrawlerFailureTags(input)
  if (tags.includes('login_required') || tags.includes('auth_required')) return 'gui'
  if (tags.includes('captcha') || tags.includes('captcha_or_block')) return 'gui'
  if (tags.includes('access_blocked') && (input.itemCount ?? 0) === 0) return 'gui'
  if (tags.includes('spa_or_js') && (input.itemCount ?? 0) === 0) return 'gui'
  if (tags.includes('browser_empty') && tags.includes('execution_failed')) return 'gui'
  if (input.planNeedsLogin && (input.itemCount ?? 0) === 0) return 'gui'
  return null
}
