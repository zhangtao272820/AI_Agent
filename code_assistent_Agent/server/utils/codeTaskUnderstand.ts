/**
 * Code Agent LLM-first 任务理解：task_kind / hint_files / write_allowed。
 */

import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { createCodeChatOpenAI } from './codeChatOpenAI'
import type { CodeTaskKind } from './manager_task'
import {
  CodeTaskUnderstandSchema,
  isCodeTaskUnderstandEnabled,
  type CodeTaskUnderstandParsed,
} from './codeTaskUnderstandSchema'
import { recordCodeNluMetric } from './code_nlu_metrics'

export { CodeTaskUnderstandSchema, isCodeTaskUnderstandEnabled } from './codeTaskUnderstandSchema'

export type CodeTaskUnderstandResult = CodeTaskUnderstandParsed & {
  source: 'llm' | 'manager' | 'fallback'
}

function extractFirstJsonObject(text: string): Record<string, unknown> | null {
  const s = String(text || '').trim()
  const start = s.indexOf('{')
  if (start < 0) return null
  let depth = 0
  for (let i = start; i < s.length; i++) {
    const ch = s[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        try {
          const obj = JSON.parse(s.slice(start, i + 1))
          return obj && typeof obj === 'object' ? (obj as Record<string, unknown>) : null
        } catch {
          return null
        }
      }
    }
  }
  return null
}

const UNDERSTAND_SYSTEM = [
  '你是 Code Assist Agent 任务理解器。根据用户任务判断应走的执行模式，只输出 JSON。',
  '',
  'task_kind 说明：',
  '- compute：汇总/推导上游 facts，输出 JSON，不读写仓库',
  '- inspect：读仓库、分析、定位、解释、跑只读检查',
  '- edit：受控修改文件并 validate（write_allowed=true）',
  '- script：运行 npm script / 测试命令（不改文件内容）',
  '',
  '规则：',
  '- 有 upstream_context 且仅需汇总数字/图表 → compute',
  '- 明确要求改代码/加功能/修 bug/写文件 → edit',
  '- 分析/解释/在哪/读代码 → inspect',
  '- 跑测试/typecheck/lint 脚本 → script',
  '- hint_files：用户或上下文提到的文件路径',
  '- completion_criteria：完成标准，如 typecheck 绿、测试通过',
  '- confidence < 0.5 时 task_kind 选 inspect',
  '',
  '输出（纯 JSON）：',
  '{"task_kind":"...","refined_question":"...","hint_files":[],"hint_symbols":[],"completion_criteria":[],"write_allowed":false,"confidence":0.0-1.0,"rationale":"..."}',
].join('\n')

export async function understandCodeTask(input: {
  message: string
  upstreamContext?: string
  managerTaskKind?: CodeTaskKind
  apiKey?: string
  baseURL?: string
  model?: string
  signal?: AbortSignal
}): Promise<CodeTaskUnderstandResult | null> {
  if (!isCodeTaskUnderstandEnabled()) return null

  const llm = createCodeChatOpenAI({
    apiKey: input.apiKey,
    baseURL: input.baseURL,
    model: input.model,
    temperature: 0,
    maxTokens: 512,
  })

  const userLines = [
    `任务：${String(input.message || '').trim()}`,
    input.managerTaskKind ? `总管已指定 task_kind=${input.managerTaskKind}（勿改 task_kind，补全 hint_files/refined_question）` : '',
    input.upstreamContext ? `上游上下文（摘要）：${input.upstreamContext.slice(0, 1200)}` : '',
  ].filter(Boolean)

  try {
    const resp = await llm.invoke(
      [new SystemMessage(UNDERSTAND_SYSTEM), new HumanMessage(userLines.join('\n'))],
      { signal: input.signal as AbortSignal | undefined },
    )
    const content = typeof resp.content === 'string' ? resp.content : JSON.stringify(resp.content ?? '')
    const obj = extractFirstJsonObject(content)
    if (!obj) return null
    const parsed = CodeTaskUnderstandSchema.safeParse(obj)
    if (!parsed.success) {
      recordCodeNluMetric({
        ok: false,
        question: String(input.message || '').slice(0, 200),
        reason: 'schema_parse_failed',
      })
      return null
    }
    if (parsed.data.confidence < 0.5 && !input.managerTaskKind) {
      const result = {
        ...parsed.data,
        task_kind: 'inspect' as const,
        write_allowed: false,
        source: 'llm' as const,
      }
      recordCodeNluMetric({
        ok: true,
        task_kind: result.task_kind,
        source: result.source,
        confidence: parsed.data.confidence,
        hint_files: result.hint_files,
        write_allowed: result.write_allowed,
        question: String(input.message || '').slice(0, 200),
        rationale: result.rationale,
      })
      return result
    }
    const pinnedKind = input.managerTaskKind ?? parsed.data.task_kind
    const write_allowed =
      pinnedKind === 'edit' || pinnedKind === 'script'
        ? true
        : input.managerTaskKind
          ? parsed.data.write_allowed
          : parsed.data.task_kind === 'edit'
            ? true
            : parsed.data.write_allowed
    const result = {
      ...parsed.data,
      task_kind: pinnedKind,
      write_allowed,
      source: input.managerTaskKind ? ('manager' as const) : ('llm' as const),
    }
    recordCodeNluMetric({
      ok: true,
      task_kind: result.task_kind,
      source: result.source,
      confidence: result.confidence,
      hint_files: result.hint_files,
      write_allowed: result.write_allowed,
      question: String(input.message || '').slice(0, 200),
      rationale: result.rationale,
    })
    return result
  } catch {
    if (input.managerTaskKind) {
      const result = {
        task_kind: input.managerTaskKind,
        refined_question: String(input.message || '').trim().slice(0, 480),
        hint_files: [] as string[],
        write_allowed: input.managerTaskKind === 'edit' || input.managerTaskKind === 'script',
        confidence: 1,
        rationale: 'manager_task_kind_fallback',
        source: 'manager' as const,
      }
      recordCodeNluMetric({
        ok: true,
        task_kind: result.task_kind,
        source: result.source,
        confidence: result.confidence,
        write_allowed: result.write_allowed,
        question: String(input.message || '').slice(0, 200),
        rationale: result.rationale,
      })
      return result
    }
    recordCodeNluMetric({
      ok: false,
      question: String(input.message || '').slice(0, 200),
      reason: 'llm_invoke_failed',
    })
    return null
  }
}
