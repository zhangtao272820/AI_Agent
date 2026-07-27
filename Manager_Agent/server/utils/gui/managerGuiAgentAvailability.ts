/**
 * GUI（Lobster）部署与健康：供 Router / 网页执行模式启发器判断 gui 是否可入 allowedAgents。
 */

import { resolveAgentUrl } from '../platform/agentEndpoints'
import type { ExecutableAgent } from '../../graph/core/routing/routeFinalize'

export type GuiHealthStatus = 'healthy' | 'degraded' | 'down' | 'unknown' | 'unconfigured'

export function isGuiAgentConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(String(resolveAgentUrl(env.LOBSTER_AGENT_WS_URL, env) || '').trim())
}

export function guiAgentHealthStatus(
  toolHealth?: { agents?: Array<{ agent: string; status: string }> } | null,
  env: NodeJS.ProcessEnv = process.env
): GuiHealthStatus {
  if (!isGuiAgentConfigured(env)) return 'unconfigured'
  const row = (toolHealth?.agents || []).find((a) => String(a.agent).trim() === 'gui')
  if (!row) return 'unknown'
  const s = String(row.status || '').trim()
  if (s === 'down') return 'down'
  if (s === 'degraded') return 'degraded'
  return 'healthy'
}

/** Lobster 已配置且非 down → 可参与路由白名单 */
export function isGuiAgentRoutable(
  toolHealth?: { agents?: Array<{ agent: string; status: string }> } | null,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (!isGuiAgentConfigured(env)) return false
  const st = guiAgentHealthStatus(toolHealth, env)
  return st === 'healthy' || st === 'degraded' || st === 'unknown'
}

/** 网页执行模式 LLM 的 allowed 候选：已部署时强制纳入 gui */
export function agentsForWebExecutionHeuristic(
  allowed: ExecutableAgent[],
  toolHealth?: { agents?: Array<{ agent: string; status: string }> } | null,
  env: NodeJS.ProcessEnv = process.env
): ExecutableAgent[] {
  const merged = new Set(allowed)
  if (isGuiAgentRoutable(toolHealth, env)) merged.add('gui')
  return [...merged]
}

export function formatGuiDeployHintForRouter(
  toolHealth?: { agents?: Array<{ agent: string; status: string }> } | null,
  env: NodeJS.ProcessEnv = process.env
): string {
  if (!isGuiAgentConfigured(env)) {
    return [
      '【GUI Lobster 部署】未配置 LOBSTER_AGENT_WS_URL。',
      '浏览器交互任务（打开站点、站内搜索、点击、提取第 N 条）无法走 gui，仅能 crawler/SERP。'
    ].join('\n')
  }
  const st = guiAgentHealthStatus(toolHealth, env)
  if (st === 'down') {
    return [
      '【GUI Lobster 部署】已配置但 health=down。',
      '请启动 lobster_agent（docker compose --profile extended）后再走 GUI；勿静默降级 crawler。'
    ].join('\n')
  }
  return [
    '【GUI Lobster 部署】已配置且可用（allowedAgents 可含 gui）。',
    '浏览器内「打开站点→站内搜索→点选/打开第 N 条/填表/登录/页内提取」→ **gui**（通常 needsWebSearch=false）。',
    '公网政策/参考正文/列表字段的**静态抽取**（不经浏览器操作）→ **crawler** + 总管联网搜索增强；库内+公网参考 → multi（db+crawler），禁止 gui。'
  ].join('\n')
}
