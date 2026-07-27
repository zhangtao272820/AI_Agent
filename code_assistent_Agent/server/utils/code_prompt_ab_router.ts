/**
 * P4 A/B：晋级补丁 treatment vs 仅影子补丁 control（compute / inspect / agent 共用分桶）。
 */
import { getCodeAgentEnv } from './code_agent_env'

export type PromptAbVariant = 'control' | 'treatment'

const counters: Record<string, number> = {}

function hashBucket(seed: string): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0
  }
  return h % 100
}

export function resolvePromptAbVariant(userKey: string | undefined, question: string): PromptAbVariant {
  const env = getCodeAgentEnv()
  if (!env.enablePromptAbTest) return 'treatment'
  const seed = `${userKey || 'anon'}|${String(question ?? '').slice(0, 120)}`
  const bucket = hashBucket(seed)
  return bucket < env.promptAbTreatmentPercent ? 'treatment' : 'control'
}

/** inspect 路径 treatment 时附加只读深度分析提示 */
export function formatInspectStrategyHint(variant: PromptAbVariant, taskKind?: string): string {
  if (taskKind !== 'inspect' && taskKind !== 'full') return ''
  if (variant === 'control') {
    return '策略：快速只读扫描，优先给出结论与文件定位，少展开实现细节。'
  }
  return '策略：深度只读审查，说明调用链、风险点与可验证的改法建议（仍不写盘）。'
}

export function recordPromptAbObservation(variant: PromptAbVariant, ok: boolean) {
  const k = `${variant}:${ok ? 'ok' : 'fail'}`
  counters[k] = (counters[k] || 0) + 1
}

export function getPromptAbSummary() {
  const env = getCodeAgentEnv()
  return {
    enabled: env.enablePromptAbTest,
    treatmentPercent: env.promptAbTreatmentPercent,
    counters: { ...counters },
  }
}
