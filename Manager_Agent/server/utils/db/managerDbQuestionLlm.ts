import { z } from 'zod'
import { ChatOpenAI } from '@langchain/openai'
import { safeJsonParse } from '../../graph/core/shared/llmJson'
import type { LlmInvokeFn } from '../../graph/llm/taskConstraintsLlm'
import { isDbAnchoredTaskText, type DbAnchorContext } from '../../graph/core/plan/clarifyContext'
import { intentClassifyFromMeta } from '../../graph/llm/intentClassifyLlm'
import { resolveLeanDbUserQuestion } from '../../graph/core/text'
import { hasOrchestratedDbScope, resolveDbStepQuestionSync, dbQueryFocusFromMeta } from '../../graph/core/db/dbStepQuestion'

export function dbAnchorCtx(state: unknown): DbAnchorContext {
  const s = state as { meta?: unknown; intent?: string; probe?: { db?: { matched?: boolean } } }
  return {
    intentClassify: intentClassifyFromMeta(s.meta),
    intent: s?.intent,
    probeDbMatched: Boolean(s?.probe?.db?.matched)
  }
}

const DbQuestionSchema = z.object({
  question: z.string().min(2).max(900),
  confidence: z.number().min(0).max(1).optional(),
  rationale: z.string().optional()
})

export function isDbQuestionLlmEnabled(): boolean {
  return String(process.env.MANAGER_DB_QUESTION_LLM ?? '1').trim() !== '0'
}

/** 多步/复合任务须由模型拆解出 DB 子问句，不可把整句用户原话直接交给 DB */
export function needsDbQuestionLlmDecompose(input: {
  intent?: string
  stepOrRouted: string
  lastUserMessage: string
}): boolean {
  const intent = String(input.intent ?? '').trim()
  if (intent === 'multi') return true
  const routed = String(input.stepOrRouted ?? '').trim()
  const last = String(input.lastUserMessage ?? '').trim()
  if (!last || last.length < 6) return false
  if (!routed || routed === last) {
    return intent === 'db' && last.length >= 12
  }
  return last.length > routed.length + 6 || !last.includes(routed)
}

/** 规划步骤常注入 probe/表名，用户原话未提及则视为污染 */
export function stepHasInjectedTableHint(stepQuery: string, lastUser: string): boolean {
  const step = String(stepQuery ?? '').trim()
  const last = String(lastUser ?? '').trim()
  if (!step || !last) return false
  for (const tok of step.match(/[a-zA-Z][a-zA-Z0-9_]{2,}/g) ?? []) {
    if (tok.includes('_') && !last.includes(tok)) return true
  }
  const tableInStep = step.match(/([^\s，,；;]{2,40})\s*表中/)
  if (tableInStep?.[1] && !last.includes(tableInStep[1])) return true
  return false
}

/** 总管 → DB：步骤问句常为拆解短句；无业务词表，仅比较长度/包含关系 */
export function pickRichestDbQuestion(
  stepQuery: string,
  lastUser: string,
  anchorCtx?: DbAnchorContext,
  opts?: { lockOrchestratedScope?: boolean; meta?: unknown }
): string {
  const step = String(stepQuery ?? '').trim()
  const last = String(lastUser ?? '').trim()
  const lock =
    opts?.lockOrchestratedScope === true ||
    (opts?.meta != null && hasOrchestratedDbScope(opts.meta))
  if (lock) {
    const focus = dbQueryFocusFromMeta(opts?.meta, step)
    if (focus.length >= 4) return focus
    if (step.length >= 4 && (!last || step.length <= last.length * 0.95)) return step
  }
  if (opts?.lockOrchestratedScope && step.length >= 4) return step
  if (!last) return step
  if (!step) return last
  if (step === last) return last
  // 步骤问句是原问子串或明显更短 → 保留用户原话（换库通用，不依赖领域词）
  if (last.includes(step) && last.length > step.length) return last
  if (step.length + 8 <= last.length) return last
  // 规划器注入表名/模板，用户原话已是清晰 DB 问句 → 用原话（与直连 DB 一致）
  if (isDbAnchoredTaskText(last, anchorCtx) && stepHasInjectedTableHint(step, last)) return last
  if (shouldUseDirectDbUserQuestion(step, last)) return last
  return step
}

/** multi 流水线 db 步骤：与 execNodes dbNode 一致，优先用户原话 */
export function resolveMultiDbEffectiveQuery(
  stepQuery: string,
  userTask: string,
  lastUser: string,
  anchorCtx?: DbAnchorContext,
  meta?: unknown
): string {
  const fromMeta = resolveDbStepQuestionSync(stepQuery || userTask, lastUser, meta)
  if (fromMeta.length >= 4) return fromMeta
  const last = String(lastUser ?? '').trim()
  const step = String(stepQuery ?? '').trim()
  const task = String(userTask ?? '').trim()
  if (last.length >= 4 && isDbAnchoredTaskText(last, anchorCtx)) return last
  const lean = resolveLeanDbUserQuestion(step || task, last, meta)
  return pickRichestDbQuestion(lean, last, anchorCtx)
}

/** 用户原话已清晰可查时，不再经 LLM 改写（避免与 DB 直连问句不一致） */
export function shouldUseDirectDbUserQuestion(stepOrRouted: string, lastUserMessage: string): boolean {
  const last = String(lastUserMessage ?? '').trim()
  if (last.length < 4) return false
  const routed = String(stepOrRouted ?? '').trim()
  if (!routed || routed === last) return true
  if (routed.includes(last) || last.includes(routed)) return true
  const lean = resolveLeanDbUserQuestion(routed, last)
  return (
    lean === last ||
    (lean.length >= 4 && last.length >= 4 && lean.replace(/\s/g, '') === last.replace(/\s/g, ''))
  )
}

/** LLM 精炼传给 DB_Agent 的问句：去掉总管模板污染，保留实体/时间/字段约束 */
export async function refineDbQuestionByLlm(input: {
  stepOrRouted: string
  lastUserMessage: string
  llmInvoke: LlmInvokeFn
  state: unknown
}): Promise<string | null> {
  const routed = String(input.stepOrRouted ?? '').trim()
  const last = String(input.lastUserMessage ?? '').trim()
  if (!routed && !last) return null
  const probeHint = (() => {
    const probe = (input.state as { probe?: { db?: { tables?: string[]; matched?: boolean } } })?.probe
    if (!probe?.db?.matched) return ''
    const tables = Array.isArray(probe.db.tables) ? probe.db.tables.join('、') : ''
    return tables ? `probe 命中表：${tables}` : ''
  })()

  try {
    const r = await input.llmInvoke('plan', input.state, [
      [
        'system',
        [
          '你是数据库查询问句拆解器。从总管路由/用户原话中，只提取「数据库只读查询」这一步的自然语言问句。',
          '只输出 JSON，禁止 markdown；勿用关键词表或正则硬切。',
          '原则：',
          '- 多步任务（如查库+分析+报告/图表/汇总）只保留查库部分；分析、报告、可视化、知识库检索由其他 Agent 完成，不得写入 question。',
          '- 保留对象（姓名/编号）、时间口径、业务主题、指标/字段；不要添加用户未提及的过滤条件；不要编造表名。',
          '- 若 routed 与 lastUser 冲突，以 lastUser 的数据查询意图为准，可合并 routed 中明确的实体/时间补充。',
          '- 示例：用户「查询赵嘉豪的项目记录并分析数据生成报告」→ question「查询赵嘉豪的项目记录」。',
          '- question 长度 ≤ 600 字符，使用自然中文问句。',
          'schema: {"question":string,"confidence":number,"rationale":string}'
        ].join('\n')
      ],
      [
        'human',
        [
          last ? `用户原话：${last.slice(0, 800)}` : '',
          routed && routed !== last ? `路由/步骤问句：${routed.slice(0, 900)}` : '',
          probeHint
        ]
          .filter(Boolean)
          .join('\n\n')
      ]
    ], { tier: 'light' })
    const parsed = DbQuestionSchema.safeParse(safeJsonParse(String(r.text ?? '').trim()))
    if (!parsed.success || Number(parsed.data.confidence ?? 0) < 0.5) return null
    const q = String(parsed.data.question ?? '').trim()
    return q.length >= 2 ? q.slice(0, 900) : null
  } catch {
    return null
  }
}

export async function refineDbQuestionByChatModel(
  stepOrRouted: string,
  lastUserMessage: string,
  probe: { db?: { tables?: string[]; matched?: boolean } } | null | undefined,
  model: ChatOpenAI | null
): Promise<string | null> {
  if (!model) return null
  const routed = String(stepOrRouted ?? '').trim()
  const last = String(lastUserMessage ?? '').trim()
  if (!routed && !last) return null
  const probeHint =
    probe?.db?.matched && Array.isArray(probe.db.tables)
      ? `probe 命中表：${probe.db.tables.join('、')}`
      : ''
  try {
    const res = await model.invoke([
      [
        'system',
        [
          '你是数据库查询问句拆解器。从用户原话/路由步骤中只提取数据库只读查询这一步。',
          '只输出 JSON，禁止 markdown；勿用关键词表硬匹配。',
          '多步任务只保留查库部分；去掉分析、报告、图表、知识库检索等非 DB 指令。',
          'schema: {"question":string,"confidence":number,"rationale":string}'
        ].join('\n')
      ],
      [
        'human',
        [
          last ? `用户原话：${last.slice(0, 800)}` : '',
          routed && routed !== last ? `路由/步骤问句：${routed.slice(0, 900)}` : '',
          probeHint
        ]
          .filter(Boolean)
          .join('\n\n')
      ]
    ])
    const parsed = DbQuestionSchema.safeParse(safeJsonParse(String(res.content ?? '').trim()))
    if (!parsed.success || Number(parsed.data.confidence ?? 0) < 0.5) return null
    const q = String(parsed.data.question ?? '').trim()
    return q.length >= 2 ? q.slice(0, 900) : null
  } catch {
    return null
  }
}

/** 异步精炼 DB 问句：优先 LLM，失败回退同步 resolveLeanDbUserQuestion */
export async function resolveLeanDbUserQuestionAsync(input: {
  stepOrRouted: string
  lastUserMessage: string
  llmInvoke?: LlmInvokeFn | null
  llm?: { openaiApiKey?: string; openaiModel?: string; openaiBaseUrl?: string } | null
  state?: unknown
  probe?: { db?: { tables?: string[]; matched?: boolean } } | null
}): Promise<string> {
  const lockScope = hasOrchestratedDbScope(input.state)
  const scopeOpts = lockScope ? { lockOrchestratedScope: true as const } : undefined
  const fallback = resolveLeanDbUserQuestion(input.stepOrRouted, input.lastUserMessage, input.state)
  const intent = String((input.state as { intent?: string } | null)?.intent ?? '').trim()
  const last = String(input.lastUserMessage ?? '').trim()
  const routed = String(input.stepOrRouted ?? '').trim()
  if (lockScope && routed.length >= 4) {
    return pickRichestDbQuestion(routed, last, dbAnchorCtx(input.state), scopeOpts)
  }
  const mustDecompose = needsDbQuestionLlmDecompose({ intent, stepOrRouted: routed, lastUserMessage: last })
  const anchor = dbAnchorCtx(input.state)
  const preferUserQuestion =
    !mustDecompose &&
    last.length >= 4 &&
    (shouldUseDirectDbUserQuestion(routed, last) ||
      (isDbAnchoredTaskText(last, anchor) && stepHasInjectedTableHint(routed, last)))
  if ((intent === 'db' || intent === 'multi') && preferUserQuestion) {
    return last || pickRichestDbQuestion(fallback, last)
  }
  if (!isDbQuestionLlmEnabled() && !mustDecompose) {
    return pickRichestDbQuestion(fallback, input.lastUserMessage, anchor, scopeOpts)
  }
  if (!isDbQuestionLlmEnabled() && mustDecompose) {
    return pickRichestDbQuestion(fallback, last || input.lastUserMessage, anchor, scopeOpts)
  }

  if (input.llmInvoke && input.state) {
    const refined = await refineDbQuestionByLlm({
      stepOrRouted: input.stepOrRouted,
      lastUserMessage: input.lastUserMessage,
      llmInvoke: input.llmInvoke,
      state: input.state
    })
    if (refined) return pickRichestDbQuestion(refined, input.lastUserMessage, anchor, scopeOpts)
  }

  const key = String(input.llm?.openaiApiKey ?? '').trim()
  if (key) {
    try {
      const model = new ChatOpenAI({
        apiKey: input.llm!.openaiApiKey,
        modelName: String(input.llm?.openaiModel || 'gpt-4o-mini').trim(),
        configuration: { baseURL: input.llm?.openaiBaseUrl },
        temperature: 0
      })
      const refined = await refineDbQuestionByChatModel(
        input.stepOrRouted,
        input.lastUserMessage,
        input.probe,
        model
      )
      if (refined) return pickRichestDbQuestion(refined, input.lastUserMessage, anchor, scopeOpts)
    } catch {
      /* fallback */
    }
  }

  return pickRichestDbQuestion(fallback, input.lastUserMessage, anchor, scopeOpts)
}
