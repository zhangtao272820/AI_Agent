/**
 * 抓取通道路由：UA 轮换 + HTTP/Browser/云抓取决策。
 */
import { getCapabilityProfile } from './capabilityRegistry'
import type { StructuredTaskPlan } from './crawlerAgentTaskPlanning'
import { resolveChannelPolicy } from '../utils/crawl_route_policy'
import {
  isBilibiliRankingPageUrl,
  isDouyinRankingPageUrl,
  isToutiaoRankingPageUrl,
  isWeiboRankingPageUrl,
} from './crawlerAgentTaskUtils'
import type { AgentConfig } from './crawlerAgentTypes'

const UA_POOL = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edg/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
]

function randInt(min: number, max: number) {
  const a = Number.isFinite(min) ? min : 0
  const b = Number.isFinite(max) ? max : 0
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  if (hi <= lo) return Math.floor(lo)
  return Math.floor(lo + Math.random() * (hi - lo + 1))
}

export function nowTs() {
  return Date.now()
}

export function pickUserAgent(config: AgentConfig, taskPlan?: { targetSite?: string }): string {
  if (taskPlan?.targetSite === 'jd' && Math.random() < 0.5) {
    return 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
  }
  const fixed = String(config?.crawler?.userAgent ?? '').trim()
  if (fixed) return fixed
  const idx = randInt(0, UA_POOL.length - 1)
  return UA_POOL[idx] ?? UA_POOL[0] ?? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
}

export function decideExecutionStrategy(params: {
  task: string
  url: string
  taskPlan?: StructuredTaskPlan
  userForcedBrowser: boolean
  agentMode: string
  preferredChannel?: 'http' | 'browser' | 'mcp'
  antiBotRisk?: 'low' | 'medium' | 'high'
  lastFailureTags?: string[]
}): { useBrowser: boolean; reason: string; preferMcp?: boolean } {
  if (params.userForcedBrowser) return { useBrowser: true, reason: 'user_forced' }
  if (params.preferredChannel === 'browser') {
    return { useBrowser: true, reason: 'preferred_browser' }
  }
  if (params.preferredChannel === 'mcp') {
    return { useBrowser: false, reason: 'preferred_mcp', preferMcp: true }
  }
  if (params.preferredChannel === 'http') {
    return { useBrowser: false, reason: 'preferred_http' }
  }

  const mode = String(params.agentMode || 'smart')
  if (mode === 'llm') return { useBrowser: true, reason: 'llm_mode_prefers_browser' }

  // 已注册站点补丁的 preferChannel 优先于 Bandit/经验，避免学习到 mcp 后豆瓣等 HTTP 站走云抓取
  const prof = params.taskPlan
    ? getCapabilityProfile(params.taskPlan.targetSite as any, params.taskPlan.contentType as any)
    : null
  const hasRecentFail = Array.isArray(params.lastFailureTags) && params.lastFailureTags.length > 0
  if (prof && !hasRecentFail) {
    if (prof.preferChannel === 'http') return { useBrowser: false, reason: 'capability_profile_http' }
    if (prof.preferChannel === 'browser') return { useBrowser: true, reason: 'capability_profile_browser' }
    if (prof.preferChannel === 'mcp') return { useBrowser: false, reason: 'capability_profile_mcp', preferMcp: true }
  }

  const policy = resolveChannelPolicy({
    targetSite: params.taskPlan?.targetSite,
    contentType: params.taskPlan?.contentType,
    antiBotRisk: params.antiBotRisk,
    lastFailureTags: params.lastFailureTags,
  })
  if (policy) {
    if (policy.preferMcp) {
      return { useBrowser: false, reason: policy.reason, preferMcp: true }
    }
    return { useBrowser: policy.preferBrowser, reason: policy.reason }
  }

  if (mode === 'rules') {
    if (isBilibiliRankingPageUrl(params.url) || isDouyinRankingPageUrl(params.url)) {
      return { useBrowser: true, reason: 'rules_dynamic_ranking_only' }
    }
    return { useBrowser: false, reason: 'rules_http_first' }
  }

  if (prof) {
    if (prof.preferChannel === 'browser') return { useBrowser: true, reason: 'capability_profile_browser' }
    if (prof.preferChannel === 'http') return { useBrowser: false, reason: 'capability_profile_http' }
  }
  if (
    isBilibiliRankingPageUrl(params.url) ||
    isToutiaoRankingPageUrl(params.url) ||
    isDouyinRankingPageUrl(params.url) ||
    isWeiboRankingPageUrl(params.url)
  ) {
    return { useBrowser: true, reason: 'dynamic_ranking_site' }
  }
  if (params.taskPlan?.targetSite === 'zhihu' && params.taskPlan?.contentType === 'ranking') {
    return { useBrowser: true, reason: 'zhihu_hot_needs_browser_session' }
  }
  return { useBrowser: false, reason: 'default_fastpath' }
}
