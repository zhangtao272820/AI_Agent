import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { loadTaskStack, upsertTaskStackItem, type TaskPriority } from './taskStack'
import { resolveManagerEnvBool } from '../../../utils/platform/managerEnvModes'

export function isTaskStackLlmExtractEnabled() {
  return String(process.env.MANAGER_TASK_STACK_LLM_EXTRACT ?? '0').trim() === '1'
}

/** Finalize 节点自动提取（默认跟随 MANAGER_ROUTE_MODE=convergence 为关） */
export function isTaskStackFinalizeLlmExtractEnabled(env: NodeJS.ProcessEnv = process.env) {
  return resolveManagerEnvBool('MANAGER_TASK_STACK_LLM_EXTRACT_ON_FINALIZE', env)
}

export function canRunTaskStackLlmExtract(opts?: { fromFinalize?: boolean }) {
  if (opts?.fromFinalize && isTaskStackFinalizeLlmExtractEnabled()) return true
  return isTaskStackLlmExtractEnabled()
}

type LlmExtractItem = {
  title?: string
  note?: string
  priority?: string
}

type LlmExtractDecision = {
  extract?: boolean
  reason?: string
  items?: LlmExtractItem[]
}

function createTaskStackLlm() {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim()
  const baseUrl = String(process.env.OPENAI_BASE_URL || '').trim()
  const model = String(process.env.MANAGER_MODEL_PLAN || process.env.OPENAI_MODEL || '').trim()
  if (!apiKey || !baseUrl || !model) return null
  return new ChatOpenAI({
    apiKey,
    modelName: model,
    temperature: 0.1,
    configuration: { baseURL: baseUrl }
  })
}

function safeJsonObject(text: string): LlmExtractDecision | null {
  const s = String(text || '').trim()
  const m = s.match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    const o = JSON.parse(m[0])
    return o && typeof o === 'object' ? (o as LlmExtractDecision) : null
  } catch {
    return null
  }
}

function normalizePriority(v: unknown): TaskPriority {
  const s = String(v || '').trim().toLowerCase()
  if (s === 'critical' || s === 'high' || s === 'normal' || s === 'low') return s
  return 'normal'
}

/** 用 LLM 判断用户是否要记待办，并从助手回复中提取与用户问题同一主题的可执行项 */
export async function extractAndUpsertTasksFromAssistantText(
  policyDir: string,
  sessionId: string,
  assistantText: string,
  userContext?: string,
  opts?: { fromFinalize?: boolean }
): Promise<{ added: number; skipped?: string }> {
  if (!canRunTaskStackLlmExtract(opts)) return { added: 0, skipped: 'disabled' }
  const text = String(assistantText || '').trim()
  if (text.length < 40) return { added: 0, skipped: 'too_short' }

  const userQuery = String(userContext || '').trim()
  if (!userQuery || userQuery.length < 4) return { added: 0, skipped: 'missing_user_context' }

  const llm = createTaskStackLlm()
  if (!llm) return { added: 0, skipped: 'missing_llm_env' }

  const stack = await loadTaskStack(policyDir, sessionId).catch(() => null)
  const activeStackLines = (stack?.items ?? [])
    .filter((t) => t.status !== 'done')
    .slice(0, 12)
    .map((t, i) => `${i + 1}. ${t.title}${t.note ? `（${t.note.slice(0, 80)}）` : ''}`)
  const stackBlock =
    activeStackLines.length > 0
      ? `当前会话任务栈 active 待办（勿重复添加语义相同或已覆盖项）：\n${activeStackLines.join('\n')}`
      : '当前会话任务栈 active 待办：（空）'

  try {
    const resp = await llm.invoke([
      new SystemMessage(
        [
          '你是任务栈提取器。根据用户原问题、助手回复与现有任务栈，判断是否应**新增**待办。',
          '',
          stackBlock,
          '',
          '第一步 — 判断 extract（由你综合语义判断，勿机械匹配关键词）：',
          '- true：用户明确或隐含希望记录/跟进某**尚未完成**的事项',
          '- false：用户只是咨询、查资料、要分析/报告/结论，没有表达要跟踪后续行动',
          '- false：用户要求当场执行（如创建日程/提醒），且助手回复表明**已完成**',
          '- false：拟提取项与任务栈 active 某项语义相同或已被该栈项覆盖（此时不要新增）',
          '',
          '第二步 — 若 extract=true，从助手回复中选出与用户原问题**同一主题**的可执行待办：',
          '- 须直接服务于用户问题的同一人物/项目/检查/交付物',
          '- 不要提取助手补充的可选检查、泛化建议、假设性「若需进一步可…」',
          '- 不要提取纯分析结论、图表说明、已完成事项',
          '- 最多 1 条；没有合适项则 extract=false、items=[]',
          '',
          '只输出严格 JSON 对象，不要 Markdown：',
          '{"extract":boolean,"reason":"简短理由","items":[{"title":"<=120字","note":"可选","priority":"critical|high|normal|low"}]}'
        ].join('\n')
      ),
      new HumanMessage(
        [
          `用户原问题：\n${userQuery.slice(0, 800)}`,
          `助手回复：\n${text.slice(0, 4000)}`,
          '输出 JSON：'
        ].join('\n\n')
      )
    ])

    const decision = safeJsonObject(String((resp as { content?: string })?.content ?? ''))
    if (!decision) return { added: 0, skipped: 'llm_parse_error' }
    if (!decision.extract) return { added: 0, skipped: 'llm_declined' }

    const items = Array.isArray(decision.items) ? decision.items : []
    let added = 0
    for (const row of items.slice(0, 1)) {
      if (!row || typeof row !== 'object') continue
      const title = String(row.title || '').trim()
      if (!title || title.length < 6) continue
      await upsertTaskStackItem(policyDir, sessionId, {
        title: title.slice(0, 240),
        note: String(row.note || decision.reason || '由模型从助手输出中提取的待办。').slice(0, 600),
        status: 'active',
        priority: normalizePriority(row.priority),
        source: 'assistant'
      })
      added += 1
    }
    return { added: added > 0 ? added : 0, skipped: added > 0 ? undefined : 'no_aligned_task' }
  } catch {
    return { added: 0, skipped: 'llm_error' }
  }
}
