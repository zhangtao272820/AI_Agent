/**
 * Manager Playbook 静态 prompt 块（SSOT：skills/<id>/skill.md；缺失时用 inline 兜底）。
 */
import {
  loadPlaybookSection,
  resolvePlaybookOrFallback,
  resolvePlaybookSectionOrFallback
} from '../../../utils/skills/loadPlaybook'

export const PLANNER_INTRO =
  '你是高级任务规划器（Planner）。你只允许处理 route 明确标为 multi 的任务。'

/** 路由静态 playbook（不含 JSON 示例、子句拆解、composed 动态块） */
export function getRouterPlaybookStatic(fallback: string): string {
  const body = resolvePlaybookOrFallback('router_playbook', fallback)
  const decomposeIdx = body.indexOf('\n## Decompose')
  if (decomposeIdx > 0) return body.slice(0, decomposeIdx).trim()
  return body
}

/** decomposeNode LLM system */
export function getRouterDecomposePlaybook(fallback: string): string {
  return resolvePlaybookSectionOrFallback('router_playbook', 'Decompose', fallback)
}

/** planner 静态规则（含 {allowed_agents} 占位符替换） */
export function getPlannerPlaybookRules(allowedAgents: string, fallback: string): string {
  const rules = resolvePlaybookSectionOrFallback('planner_playbook', 'Rules', fallback)
  return rules.replace(/\{allowed_agents\}/g, allowedAgents)
}

/** stepIsolation LLM 裁剪 system */
export function getStepSanitizeLlmSystem(fallback: string): string {
  return resolvePlaybookSectionOrFallback('step_sanitize', 'LlmSanitize', fallback)
}

/** 仅加载 playbook 正文（无 section） */
export function getPlaybookBody(skillId: string, fallback: string): string {
  return resolvePlaybookOrFallback(skillId, fallback)
}

/** 个人助理能力附录（路由/规划注入） */
export function getAdminCapabilitiesAddon(fallback = ''): string {
  const body = resolvePlaybookOrFallback('admin_capabilities', fallback)
  return body ? `\n\n## 个人助理能力（admin）\n${body}` : ''
}

/** GUI（Lobster）自动化附录（路由/规划注入） */
export function getGuiAutomationAddon(fallback = ''): string {
  const route = resolvePlaybookSectionOrFallback('gui_automation', 'Route', fallback)
  const planner = resolvePlaybookSectionOrFallback('gui_automation', 'Planner', fallback)
  const parts = [route, planner].filter((s) => s.trim())
  if (!parts.length) return ''
  return `\n\n## GUI 浏览器自动化（Lobster）\n${parts.join('\n\n')}`
}

/**
 * P2：按 allowedAgents / intent 按需注入技能附录，避免无关 playbook 撑爆上下文。
 * - 有 allowedAgents：仅注入命中的 admin/gui
 * - 仅有 intent：admin/gui/multi 才注入对应附录
 * - 皆无：保持旧行为（全量注入，兼容路由早期）
 */
export function getAgentScopedPlaybookAddons(opts?: {
  allowedAgents?: string[] | null
  intent?: string
}): string {
  const agents = (Array.isArray(opts?.allowedAgents) ? opts!.allowedAgents! : [])
    .map((a) => String(a || '').toLowerCase().trim())
    .filter(Boolean)
  const intent = String(opts?.intent || '').toLowerCase().trim()

  if (agents.length > 0) {
    let out = ''
    if (agents.includes('admin')) out += getAdminCapabilitiesAddon()
    if (agents.includes('gui')) out += getGuiAutomationAddon()
    return out
  }

  if (intent) {
    let out = ''
    if (intent === 'admin' || intent === 'multi') out += getAdminCapabilitiesAddon()
    if (intent === 'gui' || intent === 'multi') out += getGuiAutomationAddon()
    return out
  }

  return getAdminCapabilitiesAddon() + getGuiAutomationAddon()
}
