/**
 * Chat / Professional 双轨隔离：learning、experience replay、进化 hint 分桶
 */
import {
  isModeIsolateEnabled,
  resolveManagerInteractionMode,
  type ManagerInteractionMode
} from '../../../utils/platform/managerInteractionMode'
import { resolveManagerEnvBool } from '../../../utils/platform/managerEnvModes'

export function interactionModeFromMeta(meta?: unknown): ManagerInteractionMode {
  return resolveManagerInteractionMode(meta)
}

export function isModeIsolateLearningEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.MANAGER_MODE_ISOLATE_LEARNING !== undefined) {
    return resolveManagerEnvBool('MANAGER_MODE_ISOLATE_LEARNING', env)
  }
  return isModeIsolateEnabled(env)
}

export function isModeIsolateEvolutionHintEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.MANAGER_MODE_ISOLATE_EVOLUTION_HINT !== undefined) {
    return resolveManagerEnvBool('MANAGER_MODE_ISOLATE_EVOLUTION_HINT', env)
  }
  return isModeIsolateEnabled(env)
}

export function normalizeInteractionModeTag(raw: unknown): ManagerInteractionMode | '' {
  const x = String(raw ?? '').trim().toLowerCase()
  if (x === 'professional' || x === 'pro') return 'professional'
  if (x === 'chat' || x === 'dialog') return 'chat'
  return ''
}

export function interactionModeMatches(
  entryMode: unknown,
  activeMode: ManagerInteractionMode,
  opts?: { isolate?: boolean }
): boolean {
  const isolate = opts?.isolate ?? isModeIsolateLearningEnabled()
  if (!isolate) return true
  const tag = normalizeInteractionModeTag(entryMode)
  if (!tag) return true
  return tag === activeMode
}

export function orchestratorPromptModeBlock(mode: ManagerInteractionMode): string {
  if (mode === 'professional') {
    return [
      '【工作台·专业模式】',
      '- 用户未指明数据源时，用 inferredDataSources / PU-Stack 推断 db/rag/crawler/admin。',
      '- 复合任务保留 rag+db+pipeline；禁止 chatWebDirect 默认短路。',
      '- 每步 queryFocus 必须 scoped，不得重复整段用户原话。'
    ].join('\n')
  }
  return [
    '【工作台·对话模式】',
    '- DeepSeek 式网页对话：闲聊、联网搜最新资讯、写代码/解释，可 allowChatWebDirect。',
    '- 不跑 PU-Stack，不用 probe 推断 db/rag 域路由；简单任务避免过度 multi 流水线。'
  ].join('\n')
}
