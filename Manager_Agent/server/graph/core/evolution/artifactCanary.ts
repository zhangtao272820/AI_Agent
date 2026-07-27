import { createHash } from 'node:crypto'
import { loadActivePromptPatches, loadShadowPromptPatches, type PromptPatchSet } from './promptPatches'
import { loadActivePlannerRules, loadShadowPlannerRules, type PlannerRuleSet } from './plannerRules'

export function artifactCanaryPercent(envKey: string, fallback = 0): number {
  const n = Number(process.env[envKey] ?? fallback)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(100, Math.floor(n))
}

export function promptCanaryPercent() {
  const explicit = process.env.MANAGER_PROMPT_CANARY_PERCENT
  if (explicit != null && String(explicit).trim() !== '') {
    return artifactCanaryPercent('MANAGER_PROMPT_CANARY_PERCENT', 0)
  }
  return artifactCanaryPercent('MANAGER_POLICY_CANARY_PERCENT', 0)
}

export function plannerRulesCanaryPercent() {
  const explicit = process.env.MANAGER_PLANNER_RULES_CANARY_PERCENT
  if (explicit != null && String(explicit).trim() !== '') {
    return artifactCanaryPercent('MANAGER_PLANNER_RULES_CANARY_PERCENT', 0)
  }
  return artifactCanaryPercent('MANAGER_POLICY_CANARY_PERCENT', 0)
}

/** 按 sessionId 稳定分桶 */
export function sessionInCanaryBucket(sessionId: string | undefined, salt: string, percent: number): boolean {
  const sid = String(sessionId || '').trim()
  if (!sid || percent <= 0) return false
  if (percent >= 100) return true
  const h = createHash('sha256').update(`${salt}|${sid}`).digest()
  return h.readUInt32BE(0) % 100 < percent
}

export type ResolvedPromptPatches = {
  patches: PromptPatchSet | null
  source: 'active' | 'shadow_canary' | 'none'
  canary: boolean
}

export type ResolvedPlannerRules = {
  rules: PlannerRuleSet | null
  source: 'active' | 'shadow_canary' | 'none'
  canary: boolean
}

export async function resolveEffectivePromptPatches(
  dir: string,
  sessionId?: string,
  opts?: { suppressCanary?: boolean }
): Promise<ResolvedPromptPatches> {
  const active = await loadActivePromptPatches(dir)
  const percent = promptCanaryPercent()
  if (opts?.suppressCanary || !sessionInCanaryBucket(sessionId, 'prompt-canary', percent)) {
    return { patches: active, source: active ? 'active' : 'none', canary: false }
  }
  const shadow = await loadShadowPromptPatches(dir)
  if (shadow) return { patches: shadow, source: 'shadow_canary', canary: true }
  return { patches: active, source: active ? 'active' : 'none', canary: false }
}

export async function resolveEffectivePlannerRules(
  dir: string,
  sessionId?: string,
  opts?: { suppressCanary?: boolean }
): Promise<ResolvedPlannerRules> {
  const active = await loadActivePlannerRules(dir)
  const percent = plannerRulesCanaryPercent()
  if (opts?.suppressCanary || !sessionInCanaryBucket(sessionId, 'planner-rules-canary', percent)) {
    return { rules: active, source: active ? 'active' : 'none', canary: false }
  }
  const shadow = await loadShadowPlannerRules(dir)
  if (shadow) return { rules: shadow, source: 'shadow_canary', canary: true }
  return { rules: active, source: active ? 'active' : 'none', canary: false }
}
