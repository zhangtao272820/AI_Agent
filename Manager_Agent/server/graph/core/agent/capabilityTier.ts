/** 能力层 T0～T3 粗分（CF-5 token 可观测） */
export type CapabilityTier = 'T0' | 'T1' | 'T2' | 'T3' | 'unknown'

export function resolveCapabilityTierFromModel(model: unknown): CapabilityTier {
  const m = String(model ?? '').trim().toLowerCase()
  if (!m || m === 'unknown') return 'unknown'
  if (/coder|sql|code/.test(m)) return 'T2'
  if (/vl|vision|ocr|asr|omni/.test(m)) return 'T3'
  if (/plus|max|reason/.test(m) && !/flash|turbo|14b|8b/.test(m)) return 'T1'
  if (/flash|turbo|14b|8b|route|qwen3\.5-flash/.test(m)) return 'T0'
  return 'unknown'
}

export function aggregateTokensByTier(
  rows: Array<{ model?: unknown; tokens?: unknown }>,
): Record<CapabilityTier, number> {
  const out: Record<CapabilityTier, number> = { T0: 0, T1: 0, T2: 0, T3: 0, unknown: 0 }
  for (const rec of rows) {
    const tok = Number(rec.tokens ?? 0)
    if (!Number.isFinite(tok) || tok <= 0) continue
    const tier = resolveCapabilityTierFromModel(rec.model)
    out[tier] = (out[tier] || 0) + tok
  }
  return out
}
