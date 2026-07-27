/** Nuxt prod build 会把 nuxt.config 里的 runtimeConfig 烘焙进 .output；密钥与 MySQL 须在运行时从 process.env 补全。 */

function pickEnv(...keys: string[]): string {
  for (const k of keys) {
    const v = String(process.env[k] ?? '').trim()
    if (v) return v
  }
  return ''
}

export function resolveMysqlFromEnv(fallback?: {
  host?: string
  port?: number
  user?: string
  password?: string
  database?: string
}) {
  const host = pickEnv('MYSQL_HOST', 'DB_AGENT_MYSQL_HOST') || String(fallback?.host ?? '127.0.0.1')
  const portRaw = pickEnv('MYSQL_PORT', 'DB_AGENT_MYSQL_PORT') || String(fallback?.port ?? 3306)
  const port = Number(portRaw)
  return {
    host,
    port: Number.isFinite(port) && port > 0 ? port : 3306,
    user: pickEnv('MYSQL_USER', 'DB_AGENT_MYSQL_USER') || String(fallback?.user ?? 'root'),
    password: String(
      pickEnv('MYSQL_PASSWORD', 'DB_AGENT_MYSQL_PASSWORD') ||
        (fallback?.password != null ? fallback.password : '')
    ),
    database:
      pickEnv('MYSQL_DATABASE', 'DB_AGENT_MYSQL_DATABASE') || String(fallback?.database ?? ''),
  }
}

export function resolveOpenAiFromEnv(runtime?: Record<string, unknown>) {
  const rt = runtime ?? {}
  return {
    openaiApiKey: String(rt.openaiApiKey || pickEnv('OPENAI_API_KEY', 'QWEN_API_KEY', 'DASHSCOPE_API_KEY')).trim() || undefined,
    openaiBaseUrl:
      String(rt.openaiBaseUrl || pickEnv('OPENAI_BASE_URL', 'QWEN_BASE_URL') || 'https://dashscope.aliyuncs.com/compatible-mode/v1').trim() ||
      undefined,
    openaiModel: String(rt.openaiModel || pickEnv('OPENAI_MODEL', 'QWEN_MODEL') || 'qwen3.5-flash').trim() || undefined,
    openaiOrchestrationModel:
      String(rt.openaiOrchestrationModel || pickEnv('OPENAI_ORCHESTRATION_MODEL', 'QWEN_PLANNER_MODEL')).trim() || undefined,
    openaiNluModel: String(rt.openaiNluModel || pickEnv('OPENAI_NLU_MODEL')).trim() || undefined,
    openaiAgentModel: String(rt.openaiAgentModel || pickEnv('OPENAI_AGENT_MODEL')).trim() || undefined,
    openaiComplexModel: String(rt.openaiComplexModel || pickEnv('OPENAI_COMPLEX_MODEL')).trim() || undefined,
    openaiEmbeddingModel:
      String(rt.openaiEmbeddingModel || pickEnv('EMBEDDING_MODEL', 'OPENAI_EMBEDDING_MODEL') || 'text-embedding-v1').trim() ||
      undefined,
  }
}
