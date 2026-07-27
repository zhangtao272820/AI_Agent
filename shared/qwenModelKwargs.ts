/**
 * 百炼 OpenAI 兼容接口：Qwen3 / Qwen3.5 混合模型默认可能开启思考模式，路由/NLU 等轻调用应默认关闭。
 * 通过 QWEN_ENABLE_THINKING=1 或 CAP_ENABLE_THINKING=1 全局开启。
 */

export function isQwen3HybridModel(modelName: string): boolean {
  // qwen3 / qwen3.5 / qwen3-coder 等混合思考模型均需显式 enable_thinking
  return /^qwen3/i.test(String(modelName ?? '').trim())
}

export function readQwenEnableThinkingFromEnv(env: Record<string, string | undefined> = process.env as Record<string, string | undefined>): boolean {
  const raw = String(env.QWEN_ENABLE_THINKING ?? env.OPENAI_ENABLE_THINKING ?? env.CAP_ENABLE_THINKING ?? '0').trim().toLowerCase()
  if (raw === 'off' || raw === 'no' || raw === 'false' || raw === '0') return false
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on'
}

export function buildQwenModelKwargs(
  modelName: string,
  opts?: { enableThinking?: boolean; skipForVision?: boolean }
): Record<string, unknown> | undefined {
  if (opts?.skipForVision) return undefined
  if (!isQwen3HybridModel(modelName)) return undefined
  const enable = opts?.enableThinking ?? readQwenEnableThinkingFromEnv()
  return { enable_thinking: enable }
}

export function withQwenModelKwargs<T extends Record<string, unknown>>(
  modelName: string,
  base: T,
  opts?: { enableThinking?: boolean; skipForVision?: boolean }
): T & { modelKwargs?: Record<string, unknown> } {
  const modelKwargs = buildQwenModelKwargs(modelName, opts)
  if (!modelKwargs) return base
  return { ...base, modelKwargs }
}
