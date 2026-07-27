/**
 * Architect 模式：edit 前先出步骤计划（Aider architect MVP · P3）
 */
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { createCodeChatOpenAI } from './codeChatOpenAI'
import {
  type CodeEditPlan,
  formatEditPlanBlock,
  isCodeArchitectModeEnabled,
} from './codeArchitectShared'

export { type CodeEditPlan, formatEditPlanBlock, isCodeArchitectModeEnabled } from './codeArchitectShared'

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

const PLAN_SYSTEM = [
  '你是 Code Agent 架构师（只规划不写盘）。根据任务输出 JSON 执行计划。',
  '规则：',
  '- steps 是可执行小步（读文件 → patch → validate）',
  '- target_files 是必须触及的相对路径',
  '- 不要输出代码 patch，只规划',
  '输出：{"summary":"...","steps":["..."],"target_files":["..."],"risks":["..."]}',
].join('\n')

export async function planCodeEditTask(input: {
  question: string
  hintFiles?: string[]
  repoMapBlock?: string
  apiKey?: string
  baseURL?: string
  model?: string
  signal?: AbortSignal
}): Promise<CodeEditPlan | null> {
  if (!input.apiKey || !input.baseURL || !input.model) return null
  const llm = createCodeChatOpenAI({
    apiKey: input.apiKey,
    baseURL: input.baseURL,
    model: input.model,
    temperature: 0,
    maxTokens: 768,
  })
  const user = [
    `任务：${String(input.question || '').trim()}`,
    input.hintFiles?.length ? `hint_files：${input.hintFiles.join(', ')}` : '',
    input.repoMapBlock ? `仓库上下文：\n${input.repoMapBlock.slice(0, 2500)}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  try {
    const resp = await llm.invoke(
      [new SystemMessage(PLAN_SYSTEM), new HumanMessage(user)],
      { signal: input.signal as AbortSignal | undefined },
    )
    const content = typeof resp.content === 'string' ? resp.content : JSON.stringify(resp.content ?? '')
    const obj = extractFirstJsonObject(content)
    if (!obj) return null
    const steps = Array.isArray(obj.steps) ? obj.steps.map(String).filter(Boolean).slice(0, 12) : []
    const target_files = Array.isArray(obj.target_files)
      ? obj.target_files.map(String).filter(Boolean).slice(0, 16)
      : []
    const summary = String(obj.summary || '').trim()
    if (!summary && !steps.length) return null
    return {
      summary: summary || '执行代码修改计划',
      steps,
      target_files,
      risks: Array.isArray(obj.risks) ? obj.risks.map(String).filter(Boolean).slice(0, 6) : undefined,
    }
  } catch {
    return null
  }
}
