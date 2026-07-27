/**
 * 结果页 / 成功契约（P3-L2）
 * TaskSpec.successCriteria + siteRecipes.resultPageHints → verify 消费
 */

import { z } from 'zod'
import { isResultListUrl } from './lobsterAgent/leanBrowsePolicy'
import { matchSiteRecipe, type ResultPageHints } from './siteRecipes'

export type { ResultPageHints }

export const SuccessCriteriaSchema = z
  .object({
    urlIncludes: z.array(z.string().min(1).max(120)).max(8).optional(),
    urlMatches: z.string().max(200).optional(),
    selectorPresent: z.string().max(160).optional(),
    extractMin: z.number().int().min(0).max(50).optional(),
    titleIncludes: z.array(z.string().min(1).max(80)).max(6).optional(),
  })
  .passthrough()

export type SuccessCriteria = z.infer<typeof SuccessCriteriaSchema>

export function parseSuccessCriteria(raw: unknown): SuccessCriteria {
  if (!raw || typeof raw !== 'object') return {}
  const parsed = SuccessCriteriaSchema.safeParse(raw)
  return parsed.success ? parsed.data : {}
}

export function mergeSuccessCriteria(
  fromTaskSpec: unknown,
  recipeHints?: ResultPageHints | null,
): SuccessCriteria {
  const base = parseSuccessCriteria(fromTaskSpec)
  if (!recipeHints) return base
  const urlIncludes = [
    ...(Array.isArray(base.urlIncludes) ? base.urlIncludes : []),
    ...(Array.isArray(recipeHints.urlIncludes) ? recipeHints.urlIncludes : []),
  ]
  return {
    ...base,
    urlIncludes: urlIncludes.length ? Array.from(new Set(urlIncludes)).slice(0, 8) : undefined,
    urlMatches: base.urlMatches || recipeHints.urlMatches,
    selectorPresent: base.selectorPresent || recipeHints.listSelector || recipeHints.resultRootSelector,
  }
}

export function resultPageHintsFor(task: string, startUrl?: string): ResultPageHints | null {
  return matchSiteRecipe(task, startUrl)?.resultPageHints || null
}

export function isOnResultPage(url: string, criteria?: SuccessCriteria | null, hints?: ResultPageHints | null): boolean {
  const u = String(url || '')
  if (isResultListUrl(u)) return true
  const includes = [
    ...(Array.isArray(criteria?.urlIncludes) ? criteria!.urlIncludes! : []),
    ...(Array.isArray(hints?.urlIncludes) ? hints!.urlIncludes! : []),
  ]
  if (includes.some((p) => p && u.includes(p))) return true
  const pattern = String(criteria?.urlMatches || hints?.urlMatches || '').trim()
  if (pattern) {
    try {
      if (new RegExp(pattern, 'i').test(u)) return true
    } catch {
      /* invalid pattern */
    }
  }
  return false
}

export function evaluateSuccessCriteria(input: {
  url: string
  title?: string
  extractCount?: number
  selectorHits?: number
  criteria: SuccessCriteria
}): { ok: boolean; reason: string; missing: string[] } {
  const missing: string[] = []
  const c = input.criteria || {}
  if (Array.isArray(c.urlIncludes) && c.urlIncludes.length) {
    const ok = c.urlIncludes.some((p) => String(input.url || '').includes(p))
    if (!ok) missing.push(`urlIncludes:${c.urlIncludes.join('|')}`)
  }
  if (c.urlMatches) {
    try {
      if (!new RegExp(String(c.urlMatches), 'i').test(String(input.url || ''))) {
        missing.push(`urlMatches:${c.urlMatches}`)
      }
    } catch {
      missing.push('urlMatches:invalid')
    }
  }
  if (Array.isArray(c.titleIncludes) && c.titleIncludes.length) {
    const t = String(input.title || '')
    if (!c.titleIncludes.some((p) => t.includes(p))) missing.push(`titleIncludes`)
  }
  if (typeof c.extractMin === 'number' && c.extractMin > 0) {
    if (Math.max(0, Number(input.extractCount || 0)) < c.extractMin) {
      missing.push(`extractMin:${c.extractMin}`)
    }
  }
  if (c.selectorPresent && typeof input.selectorHits === 'number' && input.selectorHits <= 0) {
    missing.push(`selectorPresent:${c.selectorPresent}`)
  }
  if (!missing.length) return { ok: true, reason: 'success_criteria_met', missing: [] }
  return { ok: false, reason: `success_criteria_missing:${missing[0]}`, missing }
}
