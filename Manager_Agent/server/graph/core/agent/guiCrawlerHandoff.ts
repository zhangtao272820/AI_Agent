/**
 * Crawler → GUI 自动回流：检测到登录墙/SPA 时动态追加 gui 步骤
 */

import type { Step } from '../../../utils/shared/taskPlan'
import { isGuiAgentRoutable } from '../../../utils/gui/managerGuiAgentAvailability'
import { extractStartUrlFromTask } from './guiTaskPayload'

export function isGuiCrawlerHandoffEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.MANAGER_GUI_CRAWLER_HANDOFF ?? '1').trim() !== '0'
}

export function crawlerOutcomeRouteSuggestion(outcome: {
  evidence?: { routeSuggestion?: string }
}): string {
  return String(outcome?.evidence?.routeSuggestion || '').trim()
}

export function buildGuiHandoffTask(crawlerTask: string): string {
  const base = String(crawlerTask || '').trim()
  if (!base) return '在浏览器中完成页面交互（登录/点击/填表）'
  if (/登录|填表|GUI|浏览器|点击|提交/i.test(base)) return base
  return `页面需浏览器交互（登录/SPA），请继续完成：${base}`
}

export function buildGuiHandoffStep(params: {
  crawlerTask: string
  crawlerStepId: string
  existingSteps: Step[]
  startUrl?: string
}): Step | null {
  if (params.existingSteps.some((s) => s.agent === 'gui')) return null
  const stepId = String(params.crawlerStepId || '').trim()
  if (!stepId) return null
  const task = buildGuiHandoffTask(params.crawlerTask)
  const startUrl = String(params.startUrl || extractStartUrlFromTask(task) || '').trim()
  const query = startUrl && !task.includes(startUrl) ? `${task}\n起始URL: ${startUrl}` : task
  return {
    id: `step_gui_handoff_${params.existingSteps.length + 1}`,
    agent: 'gui',
    query,
    dependsOn: [stepId]
  }
}

export function shouldInjectGuiAfterCrawler(input: {
  routeSuggestion: string
  allowedAgents?: string[]
  toolHealth?: { agents?: Array<{ agent: string; status: string }> } | null
  existingSteps: Step[]
  env?: NodeJS.ProcessEnv
}): boolean {
  if (!isGuiCrawlerHandoffEnabled(input.env)) return false
  if (input.routeSuggestion !== 'gui') return false
  if (input.existingSteps.some((s) => s.agent === 'gui')) return false
  const allowed = Array.isArray(input.allowedAgents) ? input.allowedAgents : []
  if (!allowed.includes('gui')) return false
  return isGuiAgentRoutable(input.toolHealth, input.env)
}
