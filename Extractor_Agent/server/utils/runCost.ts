/**
 * 单次采集 run 成本与路径观测（写入 meta / AgentResult，不破坏总管协议）。
 */
export type ExtractorRunCost = {
  llm_extract_calls: number
  template_hit: boolean
  patch_hit: boolean
  patch_id?: string
  extract_path?: string
  serp_fallback_used: boolean
  rule_extract_attempts: number
}

export function ensureRunCost(options: Record<string, unknown> | undefined | null): ExtractorRunCost {
  const cur = (options as any)?.__runCost as ExtractorRunCost | undefined
  if (cur && typeof cur === 'object') return cur
  const fresh: ExtractorRunCost = {
    llm_extract_calls: 0,
    template_hit: false,
    patch_hit: false,
    serp_fallback_used: false,
    rule_extract_attempts: 0,
  }
  if (options && typeof options === 'object') (options as any).__runCost = fresh
  return fresh
}

export function bumpRunCost(options: Record<string, unknown> | undefined | null, patch: Partial<ExtractorRunCost>) {
  const cost = ensureRunCost(options)
  if (patch.llm_extract_calls) cost.llm_extract_calls += patch.llm_extract_calls
  if (patch.rule_extract_attempts) cost.rule_extract_attempts += patch.rule_extract_attempts
  if (patch.template_hit) cost.template_hit = true
  if (patch.patch_hit) cost.patch_hit = true
  if (patch.patch_id) cost.patch_id = patch.patch_id
  if (patch.extract_path) cost.extract_path = patch.extract_path
  if (patch.serp_fallback_used) cost.serp_fallback_used = true
}

export function runCostToMeta(cost: ExtractorRunCost | undefined | null) {
  if (!cost) return {}
  return {
    llm_extract_calls: cost.llm_extract_calls,
    template_hit: cost.template_hit,
    patch_hit: cost.patch_hit,
    patch_id: cost.patch_id,
    extract_path: cost.extract_path,
    serp_fallback_used: cost.serp_fallback_used,
    rule_extract_attempts: cost.rule_extract_attempts,
  }
}
