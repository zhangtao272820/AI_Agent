import { z } from 'zod'

export const LobsterTaskKindSchema = z.enum([
  'search',
  'navigate',
  'extract',
  'form_fill',
  'login',
  'video_play',
  'social_engagement',
  'desktop_app',
  'mobile_app',
  'multi_step',
  'monitor',
  'unknown',
])

export const LobsterBrowserProfileSchema = z.enum(['managed', 'user', 'auto'])

export const LobsterTaskUnderstandSchema = z.object({
  canonical_task: z.string().min(4).max(600),
  start_url: z.string().max(500).optional(),
  engine_hint: z.enum(['classic', 'mcp', 'stagehand', 'desktop', 'mobile', 'auto']).default('auto'),
  task_kind: LobsterTaskKindSchema.default('unknown'),
  browser_profile: LobsterBrowserProfileSchema.default('auto'),
  intent_hint: z.string().max(120).optional(),
  needs_login: z.boolean().default(false),
  explicitly_avoid_login: z.boolean().default(false),
  completion_criteria: z.string().max(320).optional(),
  target_app: z.string().max(120).optional(),
  confidence: z.number().min(0).max(1).default(0.7),
  rationale: z.string().max(320).default(''),
})

export type LobsterTaskUnderstandParsed = z.infer<typeof LobsterTaskUnderstandSchema>
export type LobsterTaskKind = z.infer<typeof LobsterTaskKindSchema>
export type LobsterBrowserProfile = z.infer<typeof LobsterBrowserProfileSchema>

/** 供 router / executor 消费的结构化 TaskSpec */
export type LobsterTaskSpec = {
  canonical_task: string
  start_url?: string
  engine_hint: 'classic' | 'mcp' | 'stagehand' | 'desktop' | 'mobile' | 'auto'
  task_kind: LobsterTaskKind
  browser_profile: 'managed' | 'user'
  intent_hint?: string
  needs_login: boolean
  explicitly_avoid_login: boolean
  completion_criteria?: string
  target_app?: string
  confidence: number
  rationale: string
  source: 'llm' | 'manager' | 'fallback'
}

export function isLobsterTaskUnderstandEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.LOBSTER_TASK_UNDERSTAND ?? '1').trim() !== '0'
}

export function lobsterUnderstandMinConfidence(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.LOBSTER_UNDERSTAND_MIN_CONF ?? 0.5)
  return Number.isFinite(n) ? Math.max(0.35, Math.min(0.95, n)) : 0.5
}

export function toLobsterTaskSpec(
  understood: LobsterTaskUnderstandParsed,
  source: LobsterTaskSpec['source'],
  fallbackProfile: 'managed' | 'user' = 'managed',
): LobsterTaskSpec {
  const profile =
    understood.browser_profile === 'user'
      ? 'user'
      : understood.browser_profile === 'managed'
        ? 'managed'
        : fallbackProfile
  return {
    canonical_task: understood.canonical_task,
    start_url: understood.start_url,
    engine_hint: understood.engine_hint,
    task_kind: understood.task_kind,
    browser_profile: profile,
    intent_hint: understood.intent_hint,
    needs_login: understood.needs_login,
    explicitly_avoid_login: understood.explicitly_avoid_login,
    completion_criteria: understood.completion_criteria,
    target_app: understood.target_app,
    confidence: understood.confidence,
    rationale: understood.rationale,
    source,
  }
}

/**
 * 将理解结果合并进 RunParams 字段（纯结构转换，无 LLM）。
 * 注意：不把 understood.engine_hint 写入 engineHint。
 * engineHint 仅表示调用方强制（API/用户）；LLM 建议只在 TaskSpec.engine_hint，
 * 供 resolveEngineFromTaskSpec 软选型并保留 fallback 链。
 */
export function applyLobsterTaskUnderstand(
  base: { task: string; startUrl?: string; engineHint?: string },
  understood: LobsterTaskUnderstandParsed | null,
): { task: string; startUrl?: string; engineHint?: string } {
  if (!understood) return base
  return {
    task: understood.canonical_task || base.task,
    startUrl: understood.start_url || base.startUrl,
    engineHint: base.engineHint,
  }
}

export function taskSpecPromptAddon(spec?: LobsterTaskSpec | null): string {
  if (!spec) return ''
  const lines = [
    spec.task_kind && spec.task_kind !== 'unknown' ? `任务类型：${spec.task_kind}` : '',
    spec.completion_criteria ? `完成标准：${spec.completion_criteria}` : '',
    spec.needs_login ? '需要登录或复用登录态' : '',
    spec.explicitly_avoid_login ? '用户明确要求不要登录' : '',
    spec.browser_profile === 'user' ? '浏览器 Profile：user（附着已登录 Chrome/CDP）' : '',
    spec.target_app ? `目标应用：${spec.target_app}` : '',
  ].filter(Boolean)
  return lines.length ? `\nTaskSpec：\n${lines.join('\n')}` : ''
}
