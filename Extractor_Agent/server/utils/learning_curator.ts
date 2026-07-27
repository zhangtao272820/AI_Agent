/**
 * P5 Curator：扫描学习信号、合并重复抽取模板、自动晋级影子 prompt。
 */
import { getExtractorAgentEnv } from './extractor_agent_env'
import {
  autoPromoteEligiblePatches,
  autoPromoteEligiblePatchesVerified,
  getPromptEvolutionSummary,
  listPromptPatches,
} from './prompt_evolution'
import { dedupeExtractTemplates, getExtractTemplateSummary } from './crawl_extract_templates'
import { getLearningSummary, readLearningSignals, type CrawlLearningSignal } from './crawl_learning'
import { getExperienceSummary } from './crawl_experience'
import { getRoutePreferencesSummary } from './crawl_route_policy'
import type { CrawlFailureTag } from './crawl_failure_tags'
import { isPromoteVerifyRequired } from '#agent-shared/evolutionPromotePolicy'

export type CuratorReport = {
  ts: string
  promotedHints: string[]
  verifyGate?: Awaited<ReturnType<typeof import('#agent-shared/evolutionVerify').verifyBeforePromote>>
  templatesDeduped: { before: number; after: number }
  shadowPatches: number
  promotableRemaining: number
  topFailureTags: Array<{ tag: string; count: number }>
  learning: ReturnType<typeof getLearningSummary>
  extractTemplates: ReturnType<typeof getExtractTemplateSummary>
  experience: ReturnType<typeof getExperienceSummary>
  routePolicy: ReturnType<typeof getRoutePreferencesSummary>
  evolution: ReturnType<typeof getPromptEvolutionSummary>
}

function inferFailureTagFromSignal(s: CrawlLearningSignal): CrawlFailureTag | string {
  if (s.empty) return 'empty_dom'
  if (s.retry_triggered && s.quality_passed === false) return 'wrong_channel'
  if (s.quality_passed === false) return 'low_coverage'
  if (s.status === 'partial_ok') return 'low_count'
  if (!s.ok && s.channel === 'http') return 'wrong_channel'
  return s.status || 'unknown'
}

function scanFailureTags() {
  const signals = readLearningSignals(600).filter((s) => s.feedback == null && (!s.ok || s.empty || s.quality_passed === false))
  const counts = new Map<string, number>()
  for (const s of signals) {
    const tag = inferFailureTagFromSignal(s)
    counts.set(tag, (counts.get(tag) || 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)
}

export async function runLearningCurator(opts?: { autoPromote?: boolean; minHits?: number }): Promise<CuratorReport> {
  const minHits = opts?.minHits ?? getExtractorAgentEnv().promptPromoteMinHits
  let promotedHints: string[] = []
  let verifyGate: CuratorReport['verifyGate']
  if (opts?.autoPromote !== false) {
    if (isPromoteVerifyRequired()) {
      const verified = await autoPromoteEligiblePatchesVerified(minHits)
      promotedHints = verified.promoted
      verifyGate = verified.verify
    } else {
      promotedHints = autoPromoteEligiblePatches(minHits)
    }
  }
  const templatesDeduped = dedupeExtractTemplates()

  return {
    ts: new Date().toISOString(),
    promotedHints,
    verifyGate,
    templatesDeduped,
    shadowPatches: listPromptPatches().filter((p) => !p.promotedAt).length,
    promotableRemaining: getPromptEvolutionSummary().promotableCount,
    topFailureTags: scanFailureTags(),
    learning: getLearningSummary(),
    extractTemplates: getExtractTemplateSummary(),
    experience: getExperienceSummary(),
    routePolicy: getRoutePreferencesSummary(),
    evolution: getPromptEvolutionSummary(),
  }
}

export function runLightweightCuratorOnCrawlEnd() {
  if (!getExtractorAgentEnv().enableAutoCurateOnQuery) return
  try {
    if (isPromoteVerifyRequired()) {
      void autoPromoteEligiblePatchesVerified().then(() => undefined).catch(() => undefined)
    } else {
      autoPromoteEligiblePatches()
    }
    dedupeExtractTemplates()
  } catch {
    /* ignore */
  }
}
