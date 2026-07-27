/**
 * 路由终态：Router LLM 的 intent / allowedAgents 为唯一权威。
 * 代码只做 JSON 规范化、forced 锁定、写闸（admin）、任务约束补全（visualize/report）；不在此阶段剔除 toolHealth / Bandit。
 */

import type { IntentClassifyResult } from '../../llm/intentClassifyLlm'
import type { TaskConstraints } from '../plan'

const EXECUTABLE_AGENTS = [
  'db',
  'rag',
  'code',
  'crawler',
  'gui',
  'admin',
  'clean',
  'visualize',
  'report',
  'multimodal',
  'music',
  'video'
] as const

export type ExecutableAgent = (typeof EXECUTABLE_AGENTS)[number]

/** probe / 子句拆解结果推断 allowedAgents，修复 LLM 返回 multi 但列表为空 */
export function inferAllowedAgentsFromProbe(input: {
  intent?: string
  probe?: { db?: { matched?: boolean }; rag?: { hits?: number } } | null
  clauseAgents?: string[]
}): ExecutableAgent[] {
  const out: ExecutableAgent[] = []
  const seen = new Set<string>()
  const push = (a: string) => {
    const x = String(a ?? '').trim()
    if (!EXECUTABLE_AGENTS.includes(x as ExecutableAgent) || seen.has(x)) return
    seen.add(x)
    out.push(x as ExecutableAgent)
  }

  for (const a of input.clauseAgents ?? []) push(a)

  const intent = String(input.intent ?? '').trim()
  if (EXECUTABLE_AGENTS.includes(intent as ExecutableAgent)) push(intent)

  // probe 仅补强已判定的单源意图，不得凭弱信号把 multi 扩成 db+rag
  if (intent === 'db' && Boolean(input.probe?.db?.matched)) push('db')
  if (intent === 'rag' && Number(input.probe?.rag?.hits ?? 0) > 0) push('rag')

  return out
}

export function normalizeLlmAllowedAgents(raw: unknown): ExecutableAgent[] {
  if (!Array.isArray(raw)) return []
  const out: ExecutableAgent[] = []
  const seen = new Set<string>()
  for (const x of raw) {
    const a = String(x ?? '').trim()
    if (!EXECUTABLE_AGENTS.includes(a as ExecutableAgent)) continue
    if (seen.has(a)) continue
    seen.add(a)
    out.push(a as ExecutableAgent)
  }
  return out
}

/** 终态 intent：信任模型；仅 forced 可覆盖 */
export function finalizeLlmRouteIntent(
  rawIntent: string,
  llmAllowed: ExecutableAgent[],
  forced: string | null
): string {
  if (forced && EXECUTABLE_AGENTS.includes(forced as ExecutableAgent)) return forced
  const intent = String(rawIntent || '').trim()
  if (intent === 'multi') return 'multi'
  if (llmAllowed.length >= 2) return 'multi'
  if (llmAllowed.length === 1) {
    const only = llmAllowed[0]!
    return EXECUTABLE_AGENTS.includes(intent as ExecutableAgent) && intent === only ? intent : only
  }
  if (EXECUTABLE_AGENTS.includes(intent as ExecutableAgent)) return intent
  return 'multi'
}

/** 终态 allowedAgents：信任模型列表；不做 health / 平台 / Bandit 过滤 */
export function finalizeLlmAllowedAgents(
  intent: string,
  llmAllowed: ExecutableAgent[],
  forced: string | null
): ExecutableAgent[] {
  if (forced && EXECUTABLE_AGENTS.includes(forced as ExecutableAgent)) {
    const f = forced as ExecutableAgent
    if (intent === 'multi') {
      const base = llmAllowed.length ? [...llmAllowed] : [f]
      return base.includes(f) ? base : [f, ...base.filter((a) => a !== f)]
    }
    return [f]
  }
  if (intent === 'multi') {
    if (llmAllowed.length) return [...llmAllowed]
    return []
  }
  if (llmAllowed.length > 1) return [...llmAllowed]
  if (llmAllowed.length === 1) return [...llmAllowed]
  if (intent === 'multimodal' || intent === 'music' || intent === 'video') {
    return [intent as ExecutableAgent]
  }
  if (EXECUTABLE_AGENTS.includes(intent as ExecutableAgent)) return [intent as ExecutableAgent]
  return []
}

/**
 * 路由 LLM 漏写 visualize/report 时，按 taskConstraints 补全 allowedAgents。
 * 避免「用户要图表但 Planner 无法插入 visualize 步骤」的 P0 回归。
 */
export function supplementAllowedFromTaskConstraints(
  allowed: ExecutableAgent[],
  constraints?: TaskConstraints | null,
  opts?: {
    dbOnlyRoute?: boolean
    ragOnlyRoute?: boolean
    intentClassify?: Pick<IntentClassifyResult, 'explicitWantsReport' | 'explicitWantsVisualize'> | null
  }
): ExecutableAgent[] {
  if (opts?.dbOnlyRoute) return ['db']
  if (opts?.ragOnlyRoute) return ['rag']
  if (!constraints) return allowed
  const merged = new Set(allowed)
  let changed = false
  const wantsViz = opts?.intentClassify?.explicitWantsVisualize ? constraints.wantsVisualize : false
  const wantsReport = opts?.intentClassify?.explicitWantsReport ? constraints.wantsReport : false
  if (wantsViz && !merged.has('visualize')) {
    merged.add('visualize')
    merged.add('code')
    changed = true
  }
  if (wantsReport && !merged.has('report')) {
    merged.add('report')
    merged.add('code')
    changed = true
  }
  return changed ? [...merged] : allowed
}

/** 子句拆解已标注的 agent 补入 allowedAgents（修复路由 LLM 漏写） */
export function supplementAllowedFromClauses(
  allowed: ExecutableAgent[],
  clauseAgents: string[]
): ExecutableAgent[] {
  const merged = new Set(allowed)
  let changed = false
  for (const raw of clauseAgents) {
    const a = String(raw ?? '').trim() as ExecutableAgent
    if (!EXECUTABLE_AGENTS.includes(a) || merged.has(a)) continue
    merged.add(a)
    changed = true
  }
  return changed ? [...merged] : allowed
}

/** 末轮是否含办公/事务诉求：须 LLM 显式列入 admin，needsAdmin 单独为 true 不算 */
export function currentTurnRequestsAdmin(
  _lastUserText: string,
  intentClassify?: Pick<IntentClassifyResult, 'needsAdmin' | 'suggestedAgents'> | null,
  opts?: { routerLlmAllowed?: ExecutableAgent[]; clauseAgents?: string[] }
): boolean {
  if (opts?.routerLlmAllowed?.includes('admin')) return true
  if (opts?.clauseAgents?.includes('admin')) return true
  if (intentClassify?.suggestedAgents?.includes('admin')) return true
  return false
}

/**
 * 路由 LLM / 经验回放 / 多轮上下文误带 admin 时，按意图识别结果剔除。
 * **例外**：路由模型本轮回显式输出 admin，或子句拆解标注 admin → 信任模型，不做 code 层剔除。
 */
export function stripAdminIfNotInCurrentTurn(
  allowed: ExecutableAgent[],
  _lastUserText: string,
  intentClassify?: Pick<IntentClassifyResult, 'needsAdmin' | 'suggestedAgents'> | null,
  opts?: { routerLlmAllowed?: ExecutableAgent[]; clauseAgents?: string[] }
): ExecutableAgent[] {
  if (!allowed.includes('admin')) return allowed
  if (opts?.routerLlmAllowed?.includes('admin')) return allowed
  if (opts?.clauseAgents?.includes('admin')) return allowed
  if (currentTurnRequestsAdmin(_lastUserText, intentClassify, opts)) return allowed
  return allowed.filter((a) => a !== 'admin')
}
