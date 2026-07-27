import { z } from 'zod'
import { safeJsonParse } from '../core/shared/llmJson'
import { createManagerChatOpenAI } from '../../utils/chat/managerChatOpenAI'
import type { TaskPriority } from '../core/task/taskStack'
import type { TaskStackIngestResult } from '../core/task/taskStackIngest'

function taskStackIngestTimeoutMs(): number {
  const n = Number(process.env.MANAGER_TASK_STACK_INGEST_TIMEOUT_MS ?? 8000)
  return Number.isFinite(n) && n >= 2000 ? Math.min(20_000, Math.floor(n)) : 8000
}

const IngestSchema = z.object({
  kind: z.enum(['none', 'add', 'done', 'delete']).default('none'),
  title: z.string().optional(),
  priority: z.enum(['critical', 'high', 'normal', 'low']).optional(),
  deadline: z.string().optional(),
  confidence: z.number().min(0).max(1).optional()
})

export function isTaskStackIngestLlmEnabled(): boolean {
  return String(process.env.MANAGER_TASK_STACK_INGEST_LLM ?? '1').trim() !== '0'
}

export async function parseUserTaskStackIntentByLlm(
  userText: string,
  llm?: { openaiApiKey?: string; openaiModel?: string; openaiBaseUrl?: string } | null
): Promise<TaskStackIngestResult | null> {
  if (!isTaskStackIngestLlmEnabled()) return null
  const text = String(userText ?? '').trim()
  if (!text || text.length < 4) return null
  const key = String(llm?.openaiApiKey ?? process.env.OPENAI_API_KEY ?? '').trim()
  if (!key) return null

  try {
    const modelName = String(
      process.env.MANAGER_MODEL_ROUTE || llm?.openaiModel || process.env.OPENAI_MODEL || 'qwen-flash-2025-07-28'
    ).trim()
    const model = createManagerChatOpenAI({
      apiKey: key,
      modelName,
      openaiBaseUrl: llm?.openaiBaseUrl || process.env.OPENAI_BASE_URL,
      temperature: 0,
      maxTokens: 256
    })
    const res = await model.invoke(
      [
      [
        'system',
        [
          '你是任务栈操作解析器。根据用户单轮输入判断要对会话待办列表做什么，只输出 JSON。',
          '勿用关键词表硬匹配；按语义理解。',
          'kind=none：普通问答/查询/分析，不涉及待办增删改。',
          'kind=add：用户要记录/记住/添加待办。',
          'kind=done：标记某待办已完成。',
          'kind=delete：删除/取消某待办。',
          'title：操作目标的待办标题（4-240字）；kind=none 时省略。',
          'priority：critical|high|normal|low，仅 add 时有效。',
          'schema: {"kind":"none|add|done|delete","title":string,"priority":string,"deadline":string,"confidence":number}'
        ].join('\n')
      ],
      ['human', text.slice(0, 1200)]
      ],
      { signal: AbortSignal.timeout(taskStackIngestTimeoutMs()) }
    )
    const parsed = IngestSchema.safeParse(safeJsonParse(String(res.content ?? '').trim()))
    if (!parsed.success || Number(parsed.data.confidence ?? 0) < 0.5) return null
    if (parsed.data.kind === 'none') return { kind: 'none' }
    const title = String(parsed.data.title ?? '').trim()
    if (!title || title.length < 4) return null
    const priority = (parsed.data.priority ?? 'high') as TaskPriority
    return {
      kind: parsed.data.kind,
      title: title.slice(0, 240),
      priority,
      deadline: parsed.data.deadline ? String(parsed.data.deadline) : undefined
    }
  } catch {
    return null
  }
}
