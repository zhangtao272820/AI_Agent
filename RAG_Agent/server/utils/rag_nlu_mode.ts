/**
 * RAG NLU 档位：RAG_NLU_MODE 替代 RAG_INTENT_RAG / RAG_MERGED_UNDERSTAND 等 0/1。
 */

export type RagNluMode = 'full' | 'minimal' | 'off'

function parseRagNluMode(raw: string): RagNluMode | null {
  const v = String(raw ?? '').trim().toLowerCase()
  if (!v) return null
  if (v === 'off' || v === '0' || v === 'false' || v === 'no') return 'off'
  if (v === 'minimal' || v === 'lite' || v === 'fast') return 'minimal'
  if (v === 'full' || v === 'on' || v === '1' || v === 'default') return 'full'
  return null
}

export function resolveRagNluMode(env: NodeJS.ProcessEnv = process.env): RagNluMode {
  return parseRagNluMode(String(env.RAG_NLU_MODE ?? '')) ?? 'full'
}

type RagNluFeature = 'intent_rag' | 'merged'

const NLU_PRESETS: Record<RagNluMode, Record<RagNluFeature, boolean>> = {
  full: { intent_rag: true, merged: true },
  minimal: { intent_rag: false, merged: true },
  off: { intent_rag: false, merged: false },
}

const ENV_KEYS: Record<RagNluFeature, string> = {
  intent_rag: 'RAG_INTENT_RAG',
  merged: 'RAG_MERGED_UNDERSTAND',
}

export function isRagNluFeatureEnabled(feature: RagNluFeature, env: NodeJS.ProcessEnv = process.env): boolean {
  const key = ENV_KEYS[feature]
  const raw = env[key]
  if (raw !== undefined && String(raw).trim() !== '') {
    return !/^(0|false|off|no)$/i.test(String(raw).trim())
  }
  return NLU_PRESETS[resolveRagNluMode(env)][feature]
}

/** heuristic 路径：full 默认关；RAG_HEURISTIC_MODE=debug 时允许调试 */
export function isRagHeuristicAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  const heuristicMode = String(env.RAG_HEURISTIC_MODE ?? '').trim().toLowerCase()
  if (heuristicMode === 'debug' || heuristicMode === 'on') return true
  if (heuristicMode === 'off' || heuristicMode === 'disabled') return false
  const mode = resolveRagNluMode(env)
  if (mode === 'full') return false
  if (mode === 'off') return heuristicMode !== 'off'
  return false
}
