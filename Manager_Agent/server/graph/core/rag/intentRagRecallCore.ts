import type { IntentClassifyResult, PlanShortcutKind } from '../../llm/intentClassifyLlm'
import {
  experienceMayFastPath,
  recallHitAlignsWithUser,
  recallHitHasCapabilityDrift
} from '../memory/userIntentSupremacy'
import { resolveManagerEnvBool } from '../../../utils/platform/managerEnvModes'

export type IntentRecallHit = {
  id: string
  score: number
  source: 'playbook' | 'experience'
  matchedText: string
  primaryIntent: IntentClassifyResult['primaryIntent']
  isMulti: boolean
  suggestedAgents: IntentClassifyResult['suggestedAgents']
  isDbAnchored: boolean
  needsAdmin: boolean
  needsWeb: boolean
  explicitWantsReport: boolean
  explicitWantsVisualize: boolean
  planShortcut: PlanShortcutKind
  explanation: string
}

export type IntentRagRecallResult = {
  items: IntentRecallHit[]
  text: string
  count: number
  vectorRecall: boolean
  topHit: IntentRecallHit | null
  scenarioKey: string
}

export function isIntentRagRecallEnabled(): boolean {
  return String(process.env.MANAGER_INTENT_RAG_RECALL ?? '1').trim() !== '0'
}

export function isIntentRagFastPathEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveManagerEnvBool('MANAGER_INTENT_RAG_FAST_PATH', env)
}

function fastPathMinScore(): number {
  const n = Number(process.env.MANAGER_INTENT_RAG_FAST_MIN_SCORE ?? 0.78)
  return Number.isFinite(n) && n >= 0.55 && n <= 0.95 ? n : 0.78
}

export function intentRecallHitToClassify(hit: IntentRecallHit, confidenceCap = 0.88): IntentClassifyResult {
  const conf = Math.min(confidenceCap, 0.55 + hit.score * 0.42)
  return {
    primaryIntent: hit.primaryIntent,
    isMulti: hit.isMulti,
    suggestedAgents: [...hit.suggestedAgents],
    isDbAnchored: hit.isDbAnchored,
    needsAdmin: hit.needsAdmin,
    needsWeb: hit.needsWeb,
    explicitWantsReport: hit.explicitWantsReport,
    explicitWantsVisualize: hit.explicitWantsVisualize,
    planShortcut: hit.planShortcut,
    confidence: conf,
    rationale: `意图 RAG 快路径（${hit.source}）：${hit.explanation}`
  }
}

export function shouldUseIntentRagFastPath(
  hit: IntentRecallHit | null | undefined,
  userText?: string
): boolean {
  if (!isIntentRagFastPathEnabled() || !hit) return false
  // LLM-First：playbook 仅 hint，禁止跳过 classify LLM
  if (hit.source === 'playbook') return false
  const user = String(userText || '').trim()
  if (user && !recallHitAlignsWithUser(hit, user)) return false
  if (hit.source === 'experience' && !experienceMayFastPath()) return false
  if (user && recallHitHasCapabilityDrift(hit, user)) return false
  if (hit.source === 'experience' && hit.score < fastPathMinScore() + 0.04) return false
  return hit.score >= fastPathMinScore()
}

export function intentRagRecallFromMeta(meta: unknown): IntentRagRecallResult | null {
  const raw = (meta as { intentRagRecall?: IntentRagRecallResult } | null)?.intentRagRecall
  if (!raw || typeof raw !== 'object') return null
  if (!Array.isArray(raw.items)) return null
  return raw
}

export function alignIntentClassifyWithRecall(
  llm: IntentClassifyResult,
  recall: IntentRagRecallResult | null,
  userText?: string
): IntentClassifyResult {
  const top = recall?.topHit
  if (!top || top.score < 0.55) return llm
  const user = String(userText || '').trim()
  if (user && !recallHitAlignsWithUser(top, user)) return llm
  // playbook：只 hint，不覆盖 primaryIntent / planShortcut
  if (top.source === 'playbook') {
    if (llm.primaryIntent === top.primaryIntent && llm.planShortcut === top.planShortcut) {
      return {
        ...llm,
        confidence: Math.min(0.96, Number(llm.confidence) + 0.03),
        rationale: `${llm.rationale}；playbook hint 一致(+0.03)`
      }
    }
    return llm
  }
  const intentMatch = llm.primaryIntent === top.primaryIntent
  const shortcutMatch = llm.planShortcut === top.planShortcut
  if (!intentMatch && !shortcutMatch) return llm
  const boost = intentMatch && shortcutMatch ? 0.08 : 0.04
  return {
    ...llm,
    confidence: Math.min(0.96, Number(llm.confidence) + boost),
    rationale: `${llm.rationale}；与意图RAG召回一致(+${boost.toFixed(2)})`
  }
}
