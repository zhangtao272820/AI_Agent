/**
 * 总管 → DB 问句对齐：优先编排 blueprint / taskClauses（结构化），复合任务再交 LLM 拆解。
 * 避免 regex 切句与整句 prefetch 污染 DB schema 接地。
 */
import { collectSubAgentScopeCandidates, pickSubAgentScopeSync } from '../../../utils/route/managerSubAgentScopeLlm'
import { buildAgentScopedQuery, clausesFromMeta } from '../routing/clauses'
import { sanitizeConstraintBlockForDbAgent } from '../text'
import { stepDispatchDraftFromMeta } from '../proPuStack'

const DB_STEP_PREFIXES = [
  '从数据库查询相关记录并返回结构化结果：',
  '从数据库查询相关记录并返回结构化结果:',
  '从数据库查询相关记录：',
  '从数据库查询相关记录:',
  '从数据库查询：',
  '从数据库查询:',
  '在数据库中查询：',
  '在数据库中查询:',
  '在数据库中查询 '
] as const

function stripDbManagerPrefixes(raw: string): string {
  let s = String(raw ?? '').trim()
  for (const p of DB_STEP_PREFIXES) {
    if (s.startsWith(p)) {
      s = s.slice(p.length).trim()
      break
    }
  }
  return s
}

function stripPlanConstraintsFromQuery(query: string): string {
  const markers = ['\n\n[约束', '\n\n[上下文', '\n\n[上游', '\n\n[步骤', '\n\n[总管', '\n\n约束：', '\n\n约束:']
  let out = String(query ?? '').trim()
  let cut = out.length
  for (const m of markers) {
    const i = out.indexOf(m)
    if (i >= 0 && i < cut) cut = i
  }
  return cut < out.length ? out.slice(0, cut).trim() : out
}

/** PU stepDispatchDraft / 蓝图已给出 DB 子问句时，执行与 prefetch 均不得回退整句用户原话 */
export function hasOrchestratedDbScope(meta: unknown): boolean {
  return dbQueryFocusFromMeta(meta).length >= 4
}

export function dbQueryFocusFromMeta(meta: unknown, stepQuery = ''): string {
  const candidates = collectSubAgentScopeCandidates('db', meta, stepQuery)
  const picked = pickSubAgentScopeSync(candidates)
  if (picked.length >= 4) {
    return stripDbManagerPrefixes(stripPlanConstraintsFromQuery(picked))
  }

  const clauses = clausesFromMeta(meta)
  if (clauses.length) {
    const m = meta as Record<string, unknown> | null
    const scoped = buildAgentScopedQuery('db', clauses, String(stepQuery || '').trim(), m)
    const clean = stripPlanConstraintsFromQuery(stripDbManagerPrefixes(scoped))
    if (clean.length >= 4) return clean
  }
  return ''
}

/** 同步解析：与 DB 直连时应一致的「纯 DB 问句」 */
export function resolveDbStepQuestionSync(
  stepOrRouted: string,
  lastUserMessage: string,
  meta?: unknown
): string {
  const step = sanitizeConstraintBlockForDbAgent(String(stepOrRouted ?? '').trim())
  const last = String(lastUserMessage ?? '').trim()
  const fromOrchestration = dbQueryFocusFromMeta(meta, step)
  if (fromOrchestration.length >= 4) {
    return stripDbManagerPrefixes(fromOrchestration)
  }

  const intent = String(
    (meta as { intent?: string; intentClassify?: { primaryIntent?: string } } | null)?.intent ||
      (meta as { intentClassify?: { primaryIntent?: string } } | null)?.intentClassify?.primaryIntent ||
      ''
  ).trim()

  if (intent === 'db' && last.length >= 4) {
    return stripDbManagerPrefixes(stripPlanConstraintsFromQuery(last))
  }
  if (step.length >= 4) {
    return stripDbManagerPrefixes(stripPlanConstraintsFromQuery(step))
  }
  if (last.length >= 4) {
    return stripDbManagerPrefixes(stripPlanConstraintsFromQuery(last))
  }
  return step || last
}

/** prefetch / exec 共用：从 graph state 取 DB 子问句 */
export function resolveDbPrefetchQuestionFromState(
  state: { meta?: unknown; intent?: string; routedQuery?: string; messages?: unknown[] },
  lastUser: string,
  fallbackTask: string
): string {
  const routed = String(state.routedQuery || fallbackTask || '').trim()
  const stepHint = resolveDbStepQuestionSync(routed, lastUser, state.meta)
  if (stepHint.length >= 4) return stepHint
  return resolveDbStepQuestionSync(fallbackTask, lastUser, state.meta)
}
