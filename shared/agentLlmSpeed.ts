/**
 * 全 Agent LLM 速度基线（开源实践：关思考 / 限 token / 短超时 / 零重试 / HTTP keep-alive 由 SDK 复用连接）
 * 环境变量 AGENT_LLM_* 为集群 SSOT；各 Agent 可保留专用前缀覆盖（如 RAG_LLM_REQUEST_TIMEOUT_MS）。
 */

export function readAgentLlmRequestTimeoutMs(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>
): number {
  const n = Number(
    env.AGENT_LLM_REQUEST_TIMEOUT_MS ??
      env.MANAGER_LLM_REQUEST_TIMEOUT_MS ??
      env.RAG_LLM_REQUEST_TIMEOUT_MS ??
      env.DB_LLM_REQUEST_TIMEOUT_MS ??
      120_000
  )
  return Number.isFinite(n) && n >= 8_000 ? Math.min(180_000, Math.floor(n)) : 120_000
}

export function readAgentLlmMaxRetries(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>
): number {
  const n = Number(env.AGENT_LLM_MAX_RETRIES ?? env.MANAGER_LLM_MAX_RETRIES ?? 0)
  return Number.isFinite(n) && n >= 0 ? Math.min(2, Math.floor(n)) : 0
}

/** JSON / NLU / 路由类轻调用默认输出上限 */
export function readAgentLlmJsonMaxTokens(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>
): number {
  const n = Number(env.AGENT_LLM_JSON_MAX_TOKENS ?? 896)
  return Number.isFinite(n) && n >= 128 ? Math.min(4096, Math.floor(n)) : 896
}

/** 综合作答 / Code / Report 默认输出上限 */
export function readAgentLlmSynthMaxTokens(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>
): number {
  const n = Number(env.AGENT_LLM_SYNTH_MAX_TOKENS ?? 2048)
  return Number.isFinite(n) && n >= 256 ? Math.min(8192, Math.floor(n)) : 2048
}
