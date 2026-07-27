/** Nuxt prod build 会把 nuxt.config 里的 runtimeConfig 烘焙进 .output；密钥须在运行时从 process.env 补全。 */

export type OpenAiRuntimeSecrets = {
  openaiApiKey?: string
  openaiBaseUrl?: string
  openaiModel?: string
  openaiEmbeddingModel?: string
  openaiOrchestrationModel?: string
}

function pickEnv(...keys: string[]): string {
  for (const k of keys) {
    const v = String(process.env[k] ?? '').trim()
    if (v) return v
  }
  return ''
}

export function resolveOpenAiRuntimeSecrets(runtime: Record<string, unknown> = {}): OpenAiRuntimeSecrets {
  const openaiApiKey = String(runtime.openaiApiKey || pickEnv('OPENAI_API_KEY', 'QWEN_API_KEY', 'DASHSCOPE_API_KEY')).trim()
  const openaiBaseUrl = String(
    runtime.openaiBaseUrl || pickEnv('OPENAI_BASE_URL', 'QWEN_BASE_URL') || 'https://dashscope.aliyuncs.com/compatible-mode/v1'
  ).trim()
  const openaiModel = String(runtime.openaiModel || pickEnv('OPENAI_MODEL', 'QWEN_MODEL') || 'qwen-plus').trim()
  const openaiEmbeddingModel = String(
    runtime.openaiEmbeddingModel || pickEnv('OPENAI_EMBEDDING_MODEL', 'EMBEDDING_MODEL') || 'text-embedding-v1'
  ).trim()
  const openaiOrchestrationModel = String(
    runtime.openaiOrchestrationModel || pickEnv('OPENAI_ORCHESTRATION_MODEL', 'QWEN_PLANNER_MODEL') || openaiModel
  ).trim()
  return { openaiApiKey, openaiBaseUrl, openaiModel, openaiEmbeddingModel, openaiOrchestrationModel }
}

export function mergeOpenAiRuntimeSecrets<T extends Record<string, unknown>>(runtime: T): T & OpenAiRuntimeSecrets {
  return { ...runtime, ...resolveOpenAiRuntimeSecrets(runtime) }
}
