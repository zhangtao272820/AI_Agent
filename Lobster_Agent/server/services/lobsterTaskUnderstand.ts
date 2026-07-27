/**
 * Lobster LLM-first 任务理解：canonical task / engine / TaskSpec
 */

import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { createQwenChatModel } from './lobster/model'
import type { AgentConfig } from './lobster/types'
import type { LobsterEngineId } from './engineSelector'
import { isUserBrowserProfile, resolveBrowserProfile } from './browserProfiles'
import {
  LobsterTaskUnderstandSchema,
  isLobsterTaskUnderstandEnabled,
  lobsterUnderstandMinConfidence,
  toLobsterTaskSpec,
  type LobsterTaskSpec,
} from './lobsterTaskUnderstandSchema'

export {
  LobsterTaskUnderstandSchema,
  isLobsterTaskUnderstandEnabled,
  applyLobsterTaskUnderstand,
  taskSpecPromptAddon,
  type LobsterTaskSpec,
} from './lobsterTaskUnderstandSchema'

export { taskSpecFromManagerHints, mergeManagerAndUnderstoodTaskSpec } from './lobsterManagerTaskSpec'

export type LobsterTaskUnderstandResult = LobsterTaskSpec

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
  '你是 Lobster 浏览器自动化任务理解器。将用户任务规范化为 TaskSpec，只输出 JSON。',
  '',
  'task_kind：search|navigate|extract|form_fill|login|video_play|desktop_app|mobile_app|social_engagement|multi_step|monitor|unknown',
  'engine_hint：mcp=搜索点击；stagehand=登录填表；classic=视频；desktop=Windows原生应用(记事本/Excel)；auto=不确定',
  'browser_profile：managed=隔离浏览器；user=附着用户已登录Chrome(CDP)；auto=默认managed',
  '',
  '输出（纯 JSON）：',
  '{"canonical_task":"...","start_url":"https://...","engine_hint":"auto","task_kind":"search","browser_profile":"auto","intent_hint":"search","needs_login":false,"explicitly_avoid_login":false,"completion_criteria":"...","confidence":0.0-1.0,"rationale":"..."}',
  '',
  '规则：confidence<0.5 表示任务不清晰；百度站内搜索建议 browser_profile=user（若需登录态）',
].join('\n')

function forcedTaskSpec(input: {
  task: string
  startUrl?: string
  engineHint: LobsterEngineId
  source: LobsterTaskSpec['source']
}): LobsterTaskSpec {
  const defaultProfile = isUserBrowserProfile() ? 'user' : resolveBrowserProfile()
  return {
    canonical_task: String(input.task || '').trim(),
    start_url: input.startUrl,
    engine_hint: input.engineHint,
    task_kind: 'unknown',
    browser_profile: defaultProfile,
    needs_login: false,
    explicitly_avoid_login: false,
    confidence: 1,
    rationale: 'engine_hint_forced',
    source: input.source,
  }
}

export async function understandLobsterTask(input: {
  task: string
  startUrl?: string
  engineHint?: string
  browserProfile?: 'managed' | 'user'
  config: AgentConfig
  signal?: AbortSignal
}): Promise<LobsterTaskUnderstandResult | null> {
  if (!isLobsterTaskUnderstandEnabled()) return null

  const defaultProfile =
    input.browserProfile || (isUserBrowserProfile() ? 'user' : resolveBrowserProfile())

  const forcedEngine = String(input.engineHint || '').trim().toLowerCase()
  if (forcedEngine === 'classic' || forcedEngine === 'mcp' || forcedEngine === 'stagehand' || forcedEngine === 'desktop') {
    return forcedTaskSpec({
      task: input.task,
      startUrl: input.startUrl,
      engineHint: forcedEngine as LobsterEngineId,
      source: 'manager',
    })
  }

  const llm = createQwenChatModel(input.config, 'decision')
  if (!llm) return null

  const userLines = [
    `任务：${String(input.task || '').trim()}`,
    input.startUrl ? `起始URL：${input.startUrl}` : '',
    defaultProfile === 'user' ? '环境：user CDP profile 可用' : '',
  ].filter(Boolean)

  try {
    const resp = await llm.invoke(
      [new SystemMessage(UNDERSTAND_SYSTEM), new HumanMessage(userLines.join('\n'))],
      { signal: input.signal as AbortSignal | undefined },
    )
    const content = typeof resp.content === 'string' ? resp.content : JSON.stringify(resp.content ?? '')
    const obj = extractFirstJsonObject(content)
    if (!obj) return null
    const parsed = LobsterTaskUnderstandSchema.safeParse(obj)
    if (!parsed.success) return null
    if (parsed.data.confidence < lobsterUnderstandMinConfidence()) return null
    return toLobsterTaskSpec(parsed.data, 'llm', defaultProfile)
  } catch {
    return null
  }
}

