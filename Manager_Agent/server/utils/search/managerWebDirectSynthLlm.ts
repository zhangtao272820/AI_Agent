/**
 * 联网直答启发器（LLM）：SERP 摘要是否足以回答，无需 crawler 全量抓取。
 * 默认关闭直答路径；开启时仍须通过本启发器，避免正则/关键词误判。
 */

import { z } from 'zod'
import { safeJsonParse } from '../../graph/core/shared/llmJson'
import type { LlmInvokeFn } from '../../graph/llm/taskConstraintsLlm'
import type { WebSearchHit } from './webSearchTool'
import { webSearchFlag } from './managerWebSearchMode'
import { isChatWebMode, isManagerChatWebEnabled } from '../chat/managerChatWeb'
import type { WebExecutionModeDecision } from './managerWebExecutionModeLlm'
import { createManagerChatOpenAI } from '../chat/managerChatOpenAI'

const DirectSynthSchema = z.object({
  serpSufficient: z.boolean(),
  confidence: z.number().min(0).max(1).optional(),
  rationale: z.string().optional()
})

export function isWebDirectSynthEnabled(): boolean {
  return webSearchFlag('MANAGER_WEB_DIRECT_SYNTH', true, false)
}

export function isWebDirectSynthLlmEnabled(): boolean {
  return String(process.env.MANAGER_WEB_DIRECT_SYNTH_LLM ?? '1').trim() !== '0'
}

/** 结构性门槛：仅单源 crawler、无 GUI/加工流水线时才有资格走直答 */
export function canCandidateWebDirectSynth(input: {
  intent?: string
  allowedAgents?: string[]
  needsWebSearch?: boolean
  searchHits?: WebSearchHit[]
  webExecutionMode?: WebExecutionModeDecision | null
  chatWebOnly?: boolean
  requiresAgentPipeline?: boolean
}): boolean {
  if (input.requiresAgentPipeline === true) return false
  if (isManagerChatWebEnabled() && (input.chatWebOnly === true || isChatWebMode(input.webExecutionMode))) {
    return input.needsWebSearch === true && Array.isArray(input.searchHits) && input.searchHits.length > 0
  }
  if (!isWebDirectSynthEnabled()) return false
  if (input.needsWebSearch !== true) return false
  if (!Array.isArray(input.searchHits) || !input.searchHits.length) return false

  const agents = (Array.isArray(input.allowedAgents) ? input.allowedAgents : [])
    .map((a) => String(a ?? '').trim())
    .filter(Boolean)
  const set = new Set(agents)
  if (set.has('gui')) return false

  const pipelineBlockers = ['code', 'clean', 'report', 'visualize', 'db', 'rag', 'admin']
  if (pipelineBlockers.some((a) => set.has(a))) return false

  const intent = String(input.intent ?? '').trim()
  if (intent !== 'crawler' && intent !== 'multi') return false
  if (!set.has('crawler')) return false
  if (set.size > 1) return false

  return true
}

export async function inferWebDirectSynthByLlm(input: {
  taskText: string
  searchHits: WebSearchHit[]
  llmInvoke?: LlmInvokeFn | null
  state?: unknown
  llm?: { openaiApiKey?: string; openaiModel?: string; openaiBaseUrl?: string } | null
}): Promise<boolean> {
  if (!isWebDirectSynthLlmEnabled()) return false
  const q = String(input.taskText ?? '').trim()
  if (!q || !input.searchHits.length) return false

  const snippetBlock = input.searchHits
    .slice(0, 5)
    .map((h, i) => `[${i + 1}] ${String(h.title ?? '').slice(0, 100)}：${String(h.snippet ?? '').slice(0, 200)}`)
    .join('\n')

  const system = [
    '你是联网检索覆盖度启发器。判断：仅凭当前搜索引擎摘要，是否已足够回答用户问题，无需再全量抓取网页。',
    '只输出 JSON，禁止 markdown；勿用关键词表硬匹配。',
    'serpSufficient=true：公开摘要/标题/snippet 即可给出可靠答案（如行情、新闻要点、政策摘要、定义说明）。',
    'serpSufficient=false：需打开页面交互、抽取指定排位结果、全文/列表/榜单、登录态、或摘要明显不足以作答。',
    'schema: {"serpSufficient":boolean,"confidence":number,"rationale":string}'
  ].join('\n')

  const human = [`用户任务：${q.slice(0, 800)}`, `SERP 摘要：\n${snippetBlock}`].join('\n\n')

  try {
    if (input.llmInvoke && input.state) {
      const r = await input.llmInvoke('plan', input.state, [
        ['system', system],
        ['human', human]
      ], { tier: 'light' })
      const parsed = DirectSynthSchema.safeParse(safeJsonParse(String(r.text ?? '').trim()))
      if (parsed.success && Number(parsed.data.confidence ?? 0) >= 0.55) {
        return Boolean(parsed.data.serpSufficient)
      }
    }
    const key = String(input.llm?.openaiApiKey ?? process.env.OPENAI_API_KEY ?? '').trim()
    if (!key) return false
    const model = createManagerChatOpenAI({
      apiKey: key,
      modelName: String(input.llm?.openaiModel || process.env.OPENAI_MODEL || 'gpt-4o-mini').trim(),
      openaiBaseUrl: input.llm?.openaiBaseUrl || process.env.OPENAI_BASE_URL,
      temperature: 0,
      skipThinking: true
    })
    const res = await model.invoke([
      ['system', system],
      ['human', human]
    ])
    const parsed = DirectSynthSchema.safeParse(safeJsonParse(String(res.content ?? '').trim()))
    if (!parsed.success || Number(parsed.data.confidence ?? 0) < 0.55) return false
    return Boolean(parsed.data.serpSufficient)
  } catch {
    return false
  }
}
