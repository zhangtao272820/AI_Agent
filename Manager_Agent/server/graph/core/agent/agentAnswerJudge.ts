import { z } from 'zod'
import { safeJsonParse } from '../shared/llmJson'
import { extractStructuredPayload } from '../shared'
import type { LlmInvokeFn } from '../../llm/taskConstraintsLlm'

export type AgentAnswerVerdict = {
  usable: boolean
  empty: boolean
  failed: boolean
  conflictWithEvidence: boolean
  confidence: number
  reason?: string
}

const AnswerVerdictSchema = z.object({
  usable: z.boolean(),
  empty: z.boolean().default(false),
  failed: z.boolean().default(false),
  conflictWithEvidence: z.boolean().default(false),
  confidence: z.number().min(0).max(1).default(0.5),
  reason: z.string().optional()
})

const DEFAULT_USABLE: AgentAnswerVerdict = {
  usable: true,
  empty: false,
  failed: false,
  conflictWithEvidence: false,
  confidence: 0.5
}

/** 结构化 payload 的快速判定（无 LLM） */
export function structuralAnswerVerdict(answer: string): AgentAnswerVerdict {
  const t = String(answer ?? '').trim()
  if (!t) {
    return { usable: false, empty: true, failed: false, conflictWithEvidence: false, confidence: 0.95, reason: 'empty' }
  }
  const parsed = extractStructuredPayload(t)
  const factCount = Array.isArray(parsed?.facts) ? parsed.facts.length : 0
  if (factCount > 0) {
    return { usable: true, empty: false, failed: false, conflictWithEvidence: false, confidence: 0.9, reason: 'structured_facts' }
  }
  if (typeof parsed?.answer === 'string' && parsed.answer.trim().length >= 24) {
    return { usable: true, empty: false, failed: false, conflictWithEvidence: false, confidence: 0.75, reason: 'structured_answer' }
  }
  if (t.length < 8) {
    return { usable: false, empty: true, failed: false, conflictWithEvidence: false, confidence: 0.8, reason: 'too_short' }
  }
  return { ...DEFAULT_USABLE, confidence: 0.4, reason: 'unstructured' }
}

/** LLM 判定 Agent 回答是否可用、是否为空/失败、是否与证据矛盾 */
export async function judgeAgentAnswer(
  answer: string,
  context: { agent?: string; query?: string; evidenceSummary?: string },
  llmInvoke: LlmInvokeFn | null,
  state: unknown,
  options?: { lowCostMode?: boolean }
): Promise<AgentAnswerVerdict> {
  const structural = structuralAnswerVerdict(answer)
  if (structural.confidence >= 0.85) return structural
  if (options?.lowCostMode || !llmInvoke) return structural

  const snippet = String(answer ?? '').trim().slice(0, 2400)
  if (!snippet) return structural

  try {
    const r = await llmInvoke('critic', state, [
      [
        'system',
        [
          '你是 Agent 输出质检器。根据回答正文判断质量，只输出 JSON，不用关键词表。',
          'usable：是否含有可下游使用的实质信息（数据、事实、结论）。',
          'empty：是否明确表示无数据/无结果/查无记录。',
          'failed：是否表示执行失败、超时、抓取错误等。',
          'conflictWithEvidence：回答声称无结果但证据摘要显示有数据，或明显自相矛盾。',
          'confidence：0~1。',
          'schema: {"usable":boolean,"empty":boolean,"failed":boolean,"conflictWithEvidence":boolean,"confidence":number,"reason":string}'
        ].join('\n')
      ],
      [
        'human',
        [
          context.agent ? `agent: ${context.agent}` : '',
          context.query ? `query: ${String(context.query).slice(0, 400)}` : '',
          context.evidenceSummary ? `evidence: ${String(context.evidenceSummary).slice(0, 600)}` : '',
          `answer:\n${snippet}`
        ]
          .filter(Boolean)
          .join('\n')
      ]
    ], { tier: 'light' })
    const parsed = AnswerVerdictSchema.safeParse(safeJsonParse(String(r.text ?? '').trim()))
    if (!parsed.success || Number(parsed.data.confidence ?? 0) < 0.45) return structural
    return {
      usable: parsed.data.usable,
      empty: parsed.data.empty,
      failed: parsed.data.failed,
      conflictWithEvidence: parsed.data.conflictWithEvidence,
      confidence: parsed.data.confidence,
      reason: parsed.data.reason
    }
  } catch {
    return structural
  }
}

export function isAnswerUsable(verdict: AgentAnswerVerdict): boolean {
  return verdict.usable && !verdict.empty && !verdict.failed
}
