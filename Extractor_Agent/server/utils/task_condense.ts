/**
 * 多轮采集任务合并：短续问 LLM + 结构性 fallback。
 */
import { z } from 'zod'
import type { ChatOpenAI } from '@langchain/openai'

export type TaskTurn = { role: 'user' | 'assistant'; content: string }

const MergeSchema = z.object({
  merged_task: z.string().min(4).max(2000),
  confidence: z.number().min(0).max(1).optional(),
})

const OUTPUT_FORMATS = new Set(['csv', 'json', 'markdown'])

function safeJsonParse(text: string): unknown {
  const s = String(text ?? '').trim()
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(s.slice(start, end + 1))
  } catch {
    return null
  }
}

export function isExtractorTaskCondenseLlmEnabled(): boolean {
  return String(process.env.EXTRACTOR_TASK_CONDENSE_LLM ?? '1').trim() !== '0'
}

function lastUserTask(history: TaskTurn[]): string {
  for (let i = history.length - 1; i >= 0; i--) {
    const t = history[i]
    if (t?.role !== 'user') continue
    const c = String(t.content ?? '').trim()
    if (c.length >= 4) return c
  }
  return ''
}

function parseLimitStructural(q: string): string | null {
  const t = q.trim().toLowerCase()
  const digits = t.replace(/\D/g, '')
  if (/^top\s*\d+/.test(t) && digits) return digits
  if (/^前\s*\d+/.test(t) && digits) return digits
  if (/^\d+$/.test(t)) return t
  if (/^前\s*\d+\s*条?$/.test(t) && digits) return digits
  return null
}

export function mergeFollowupTaskStructural(task: string, history?: TaskTurn[] | null): string {
  const q = String(task ?? '').trim()
  if (!q || !Array.isArray(history) || history.length === 0) return q

  const prev = lastUserTask(history)
  if (!prev) return q

  const limit = parseLimitStructural(q)
  if (limit) return `${prev}，抓取前 ${limit} 条`

  if (q.length <= 12 && OUTPUT_FORMATS.has(q.trim().toLowerCase())) {
    return `${prev}，${q}`
  }

  return q
}

export async function mergeFollowupTaskByLlm(
  model: ChatOpenAI | null,
  task: string,
  history: TaskTurn[],
): Promise<string | null> {
  if (!model) return null
  const q = String(task ?? '').trim()
  const prev = lastUserTask(history)
  if (!q || !prev) return null
  try {
    const histLines = history
      .slice(-6)
      .map((t) => `${t.role}: ${String(t.content ?? '').slice(0, 400)}`)
      .join('\n')
    const res = await model.invoke([
      [
        'system',
        [
          '你是网页采集任务合并器。将用户当前短续问与上一轮完整任务合并为一条可独立执行的抓取任务，只输出 JSON。',
          '例如「前10条」应合并到上一轮任务并保留站点/字段约束。',
          'schema: {"merged_task":string,"confidence":number}',
        ].join('\n'),
      ],
      ['human', `历史：\n${histLines}\n\n上一轮任务：${prev.slice(0, 800)}\n\n当前续问：${q.slice(0, 200)}`],
    ])
    const parsed = MergeSchema.safeParse(safeJsonParse(String((res as { content?: string })?.content ?? '')))
    if (!parsed.success || Number(parsed.data.confidence ?? 0) < 0.5) return null
    const merged = String(parsed.data.merged_task ?? '').trim()
    return merged.length >= 4 ? merged.slice(0, 2000) : null
  } catch {
    return null
  }
}

export async function mergeFollowupTaskWithHistory(
  task: string,
  history?: TaskTurn[] | null,
  model?: ChatOpenAI | null,
): Promise<string> {
  const q = String(task ?? '').trim()
  if (!q || !Array.isArray(history) || history.length === 0) return q
  const structural = mergeFollowupTaskStructural(q, history)
  if (!isExtractorTaskCondenseLlmEnabled() || !model) return structural
  if (structural !== q) return structural
  const llm = await mergeFollowupTaskByLlm(model, q, history)
  return llm ?? structural
}
