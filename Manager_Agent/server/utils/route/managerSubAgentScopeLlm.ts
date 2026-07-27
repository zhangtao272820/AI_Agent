/**
 * 总管 → 子 Agent 子问句选取：启发模型从候选中选出可执行 scope，替代 queryFocus 词表/regex。
 */
import { z } from 'zod'
import { safeJsonParse } from '../../graph/core/shared/llmJson'
import type { LlmInvokeFn } from '../../graph/llm/taskConstraintsLlm'
import { stepDispatchDraftFromMeta } from '../../graph/core/proPuStack'
import { clausesFromMeta } from '../../graph/core/routing/clauses'
import type { Step } from '#agent-shared/taskPlan'
import { looksLikeRiskyAdminWrite } from '#agent-shared/textMarkers'

const ScopeSchema = z.object({
  chosen_text: z.string().min(2).max(900),
  confidence: z.number().min(0).max(1).optional(),
  rationale: z.string().optional()
})

const scopeDecisionCache = new Map<string, { text: string; source: string; rationale?: string }>()
const SCOPE_CACHE_MAX = 48

/** prefetch / exec 共用 scope 决策缓存键（结构性字段，非问句 regex） */
export function buildSubAgentScopeCacheKey(input: {
  agent: string
  meta: unknown
  stepQuery?: string
  userTask?: string
}): string {
  const draft = stepDispatchDraftFromMeta(input.meta)
  const clauses = clausesFromMeta(input.meta)
  return [
    String(input.agent),
    String(input.stepQuery ?? '').slice(0, 200),
    String(input.userTask ?? '').slice(0, 200),
    draft.map((d) => `${d.agent}:${d.scopedUserLanguage}`).join('|'),
    clauses.map((c) => `${c.id}:${c.text}`).join('|')
  ].join('::')
}

function readCachedScopeDecision(key: string) {
  return scopeDecisionCache.get(key)
}

function writeCachedScopeDecision(
  key: string,
  value: { text: string; source: string; rationale?: string }
) {
  if (scopeDecisionCache.size >= SCOPE_CACHE_MAX) {
    const first = scopeDecisionCache.keys().next().value
    if (first) scopeDecisionCache.delete(first)
  }
  scopeDecisionCache.set(key, value)
}

export function clearSubAgentScopeCacheForTests() {
  scopeDecisionCache.clear()
}

export type SubAgentScopeCandidate = {
  source: string
  text: string
}

/** 蓝图角色占位句（协议级检测，非业务 regex 路由） */
const GENERIC_QUERY_FOCUS_MARKERS = [
  '从数据库查询结构化数据',
  '查询天气预报或处理办公',
  '处理办公/地图类子任务',
  '与取数/图表分离',
  '从知识库/文档查询相关原始数据',
  '在浏览器中完成用户指定的页面交互',
  '仅处理下列个人助理能力',
  '日程/提醒/邮件/待办',
  '高德路线与耗时'
] as const

export function isGenericQueryFocus(text: string): boolean {
  const t = String(text ?? '').trim()
  if (t.length < 10) return false
  return GENERIC_QUERY_FOCUS_MARKERS.some((m) => t.includes(m))
}

/** 收集 admin/db 子问句候选（结构性来源，不对用户原话做 regex 切句） */
export function collectSubAgentScopeCandidates(
  agent: Step['agent'],
  meta: unknown,
  stepQuery = ''
): SubAgentScopeCandidate[] {
  const out: SubAgentScopeCandidate[] = []
  const push = (source: string, text: string) => {
    const t = String(text ?? '').trim()
    if (t.length < 4) return
    if (out.some((c) => c.text === t)) return
    out.push({ source, text: t.slice(0, 900) })
  }

  const draft = stepDispatchDraftFromMeta(meta)
  const hit = draft.find((d) => String(d.agent) === agent)
  push('step_dispatch_draft', hit?.scopedUserLanguage || '')

  const clauses = clausesFromMeta(meta)
  for (const c of clauses) {
    if (!c.agents?.includes(agent)) continue
    push('task_clause', c.text)
  }

  push('step_query', stepQuery)

  const m = meta as { planBlueprint?: { steps?: Array<{ agent?: string; queryFocus?: string }> } } | null
  const bp = m?.planBlueprint?.steps?.find((s) => String(s?.agent || '').trim() === agent)
  push('blueprint_query_focus', bp?.queryFocus || '')

  return out
}

export function isSubAgentScopeLlmEnabled(): boolean {
  return String(process.env.MANAGER_SUB_AGENT_SCOPE_LLM ?? '1').trim() !== '0'
}

/** 同步优先级回退；跳过泛化 blueprint 占位（draft/clause/step 优先） */
export function pickSubAgentScopeSync(candidates: SubAgentScopeCandidate[]): string {
  const nonGeneric = candidates.filter((c) => c.text && !isGenericQueryFocus(c.text))
  const specificClauses = nonGeneric.filter((c) => c.source === 'task_clause')
  if (specificClauses.length === 1) return specificClauses[0]!.text
  if (specificClauses.length > 1) {
    const writeLike = specificClauses.find((c) => looksLikeRiskyAdminWrite(c.text))
    if (writeLike) return writeLike.text
    return specificClauses[0]!.text
  }
  const order = ['step_dispatch_draft', 'task_clause', 'step_query', 'blueprint_query_focus']
  for (const src of order) {
    const hit = nonGeneric.find((c) => c.source === src) ?? candidates.find((c) => c.source === src)
    if (!hit?.text) continue
    if (src === 'blueprint_query_focus' && isGenericQueryFocus(hit.text)) continue
    if (isGenericQueryFocus(hit.text)) continue
    return hit.text
  }
  return nonGeneric[0]?.text || candidates[0]?.text || ''
}

/**
 * 启发模型从候选中选出应交给子 Agent 的子问句。
 * 拒绝蓝图角色占位句，优先用户子任务自然语言。
 */
export async function resolveSubAgentScopeByLlm(input: {
  agent: Step['agent']
  meta: unknown
  stepQuery?: string
  userTask?: string
  llmInvoke?: LlmInvokeFn | null
  state?: unknown
}): Promise<{ text: string; source: string; rationale?: string }> {
  const cacheKey = buildSubAgentScopeCacheKey({
    agent: input.agent,
    meta: input.meta,
    stepQuery: input.stepQuery,
    userTask: input.userTask
  })
  const cached = readCachedScopeDecision(cacheKey)
  if (cached) return cached

  const candidates = collectSubAgentScopeCandidates(input.agent, input.meta, input.stepQuery)
  const fallback = pickSubAgentScopeSync(candidates)
  const onlyGeneric =
    candidates.length === 1 && candidates[0] != null && isGenericQueryFocus(candidates[0].text)
  const shouldRunLlm =
    isSubAgentScopeLlmEnabled() &&
    Boolean(input.llmInvoke) &&
    candidates.length > 0 &&
    (candidates.length > 1 || onlyGeneric)

  if (!fallback || !shouldRunLlm) {
    const out = { text: fallback, source: 'sync_priority' }
    writeCachedScopeDecision(cacheKey, out)
    return out
  }

  const agentLabel = input.agent === 'admin' ? '个人助手 Admin' : '数据库 DB'
  const lines = candidates.map((c, i) => `${i + 1}. [${c.source}] ${c.text}`).join('\n')
  try {
    const r = await input.llmInvoke('plan', input.state, [
      [
        'system',
        [
          `你是总管编排子问句选取器（目标 Agent：${agentLabel}）。`,
          '从候选中选出应交给子 Agent 执行的**一条**自然语言子任务。',
          '只输出 JSON，禁止 markdown。',
          '规则：',
          '- 必须选语义完整、可独立执行的子问句（含具体对象/城市/指标等）。',
          '- 对 Admin 写操作（会议/待办/提醒）：必须保留用户给出的标题与时间表达，禁止裁成「创建会议」这类缺槽空壳。',
          '- 拒绝蓝图角色占位句（如「从数据库查询结构化数据」「查询天气预报或处理办公类子任务」）。',
          '- 复合任务只能选属于该 Agent 域的子句，不得选整句复合任务。',
          '- chosen_text 必须来自候选原文之一（可轻微裁剪前缀，不得编造新条件）。',
          'schema: {"chosen_text":string,"confidence":0-1,"rationale":string}'
        ].join('\n')
      ],
      [
        'human',
        [
          input.userTask ? `用户整句任务：${String(input.userTask).slice(0, 1200)}` : '',
          `候选：\n${lines}`
        ]
          .filter(Boolean)
          .join('\n\n')
      ]
    ])
    const raw = safeJsonParse(String(r ?? ''))
    const parsed = ScopeSchema.safeParse(raw)
    if (!parsed.success) return { text: fallback, source: 'sync_priority' }
    const chosen = String(parsed.data.chosen_text || '').trim()
    const matched = candidates.find((c) => c.text === chosen || chosen.includes(c.text) || c.text.includes(chosen))
    if (matched) {
      const out = { text: matched.text, source: matched.source, rationale: parsed.data.rationale }
      writeCachedScopeDecision(cacheKey, out)
      return out
    }
    const out = { text: fallback, source: 'sync_priority', rationale: parsed.data.rationale }
    writeCachedScopeDecision(cacheKey, out)
    return out
  } catch {
    const out = { text: fallback, source: 'sync_priority' }
    writeCachedScopeDecision(cacheKey, out)
    return out
  }
}
