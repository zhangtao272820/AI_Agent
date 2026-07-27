/**
 * Verify 层：覆盖率 / 去重 / 条数 / 榜单内置达标。
 */
import {
  applyTaskPlanFilters,
  type StructuredTaskPlan,
} from '../../services/crawlerAgentTaskPlanning'
import { normalizeRequestedField } from '../../services/crawlerAgentTaskUtils'

export type TaskPlanItem = Record<string, any>

export type CrawlQualityResult = {
  total: number
  fieldCoverage: number
  dupRate: number
  passFieldCoverage: boolean
  passDupRate: boolean
  passed: boolean
  effectiveFields?: string[]
  minItems?: number
  warnings?: string[]
  builtinPass?: boolean
}

export type CrawlEvalResult = {
  itemsAfterPlan: TaskPlanItem[]
  quality: CrawlQualityResult
  status: 'ok' | 'partial_ok'
  retryReasons: string[]
  attempt: number
}

export function computeResultQuality<T extends TaskPlanItem>(
  items: T[],
  requestedFields: string[],
  qualityTarget: StructuredTaskPlan['qualityTarget'],
) {
  const total = items.length
  const fields = Array.from(new Set(requestedFields.map(normalizeRequestedField).filter(Boolean)))
  const urls = items.map((x) => String(x?.url ?? '').trim()).filter(Boolean)
  const uniqueUrls = new Set(urls)
  const dupRate = urls.length > 0 ? 1 - uniqueUrls.size / urls.length : 0
  const effectiveFields = (() => {
    if (fields.length === 0) return ['title', 'url']
    const optional = fields.filter((f) => {
      if (f === 'title' || f === 'url') return true
      return items.some((it) => {
        const v = (it as any)?.[f]
        return v !== undefined && v !== null && String(v).trim() !== ''
      })
    })
    return optional.length >= 2 ? optional : ['title', 'url']
  })()
  const fieldCoverage = (() => {
    if (total === 0) return 0
    let filled = 0
    let all = 0
    for (const item of items) {
      for (const field of effectiveFields) {
        all += 1
        const val = (item as any)?.[field]
        if (val !== undefined && val !== null && String(val).trim() !== '') filled += 1
      }
    }
    return all > 0 ? filled / all : 0
  })()
  const passFieldCoverage = !qualityTarget || fieldCoverage >= qualityTarget.minFieldCoverage
  const passDupRate = !qualityTarget || dupRate <= qualityTarget.maxDupRate
  return {
    total,
    fieldCoverage,
    dupRate,
    passFieldCoverage,
    passDupRate,
    passed: passFieldCoverage && passDupRate,
    effectiveFields,
  }
}

export function passBuiltinListingQuality(
  items: TaskPlanItem[],
  taskPlan: Pick<StructuredTaskPlan, 'targetSite' | 'contentType'>,
  planTarget?: string | null,
  minItems = 1,
): boolean {
  const list = Array.isArray(items) ? items : []
  if (list.length < Math.max(1, minItems)) return false
  const coreOk = list.filter((it) => {
    const title = String(it?.title ?? '').trim()
    const url = String(it?.url ?? '').trim()
    return title.length > 0 && /^https?:\/\//i.test(url)
  }).length
  if (coreOk < Math.max(1, minItems)) return false
  if (planTarget === 'douban_top250') return true
  if (taskPlan.contentType === 'ranking' && taskPlan.targetSite !== 'generic') return true
  return false
}

export function resolveQualityCheckFields(
  taskPlan: StructuredTaskPlan,
  plan?: { target?: string; extraction?: { fields?: string[] } } | null,
  items?: TaskPlanItem[],
): string[] {
  const fromPlan = Array.isArray(plan?.extraction?.fields) ? plan!.extraction!.fields : []
  const fromTask = Array.isArray(taskPlan.fields) ? taskPlan.fields : []
  let merged = fromPlan.length ? fromPlan : fromTask
  if (plan?.target === 'douban_top250') {
    merged = ['rank', 'title', 'rating', 'url']
  } else if (taskPlan.targetSite === 'zhihu' && taskPlan.contentType === 'ranking') {
    merged = ['title', 'url', 'rank']
  }
  if (Array.isArray(items) && items.length > 0) {
    const keys = new Set(items.flatMap((it) => Object.keys(it || {})))
    const filtered = merged
      .map(normalizeRequestedField)
      .filter((f) => f && (f === 'title' || f === 'url' || keys.has(f)))
    if (filtered.length >= 2) return filtered
  }
  return merged.map(normalizeRequestedField).filter(Boolean)
}

export function resolveMinItems(
  taskPlan: StructuredTaskPlan,
  inferredLimit: number | null,
): number {
  const fromPlan = Number(taskPlan?.limit)
  const requestedLimit =
    Number.isFinite(fromPlan) && fromPlan > 0
      ? Math.floor(fromPlan)
      : Number.isFinite(Number(inferredLimit)) && Number(inferredLimit) > 0
        ? Math.floor(Number(inferredLimit))
        : null
  if (requestedLimit && requestedLimit > 0) return Math.max(1, requestedLimit)
  if (taskPlan.contentType === 'ranking' || taskPlan.contentType === 'news' || taskPlan.contentType === 'products') {
    return 3
  }
  return 1
}

export function evaluateCrawlRun(input: {
  state: any
  taskPlan: StructuredTaskPlan
  inferredLimit: number | null
  attempt: number
}): CrawlEvalResult {
  const rawItems = Array.isArray(input.state?.items) ? (input.state.items as TaskPlanItem[]) : []
  const filtered = applyTaskPlanFilters(rawItems, input.taskPlan)
  const itemsAfterPlan = filtered.items
  const planForQuality = input.state?.plan as { target?: string; extraction?: { fields?: string[] } } | undefined
  const qualityFields = resolveQualityCheckFields(input.taskPlan, planForQuality, itemsAfterPlan)
  const quality = computeResultQuality(itemsAfterPlan, qualityFields, input.taskPlan.qualityTarget)
  const minItems = resolveMinItems(input.taskPlan, input.inferredLimit)
  const builtinPass = passBuiltinListingQuality(
    itemsAfterPlan,
    input.taskPlan,
    planForQuality?.target,
    minItems,
  )
  const qualityWarnings: string[] = [...filtered.warnings]
  if (!quality.passFieldCoverage && !builtinPass) {
    qualityWarnings.push(
      `字段覆盖率过低：${quality.fieldCoverage.toFixed(2)} < ${input.taskPlan.qualityTarget?.minFieldCoverage}`,
    )
  }
  if (!quality.passDupRate) {
    qualityWarnings.push(`重复率过高：${quality.dupRate.toFixed(2)} > ${input.taskPlan.qualityTarget?.maxDupRate}`)
  }
  const belowMinItems = itemsAfterPlan.length < minItems
  if (belowMinItems) qualityWarnings.push(`结果条数不足：${itemsAfterPlan.length} < ${minItems}`)
  const qualityGatePassed = (quality.passed || builtinPass) && !belowMinItems
  const retryReasons: string[] = []
  if (!quality.passFieldCoverage && !builtinPass) retryReasons.push('low_coverage')
  if (!quality.passDupRate) retryReasons.push('high_dup')
  if (belowMinItems) retryReasons.push('low_count')
  return {
    itemsAfterPlan,
    quality: { ...quality, minItems, warnings: qualityWarnings, passed: qualityGatePassed, builtinPass },
    status: qualityGatePassed ? 'ok' : 'partial_ok',
    retryReasons,
    attempt: input.attempt,
  }
}

export function formatItemsByOutputSpec<T extends TaskPlanItem>(
  items: T[],
  outputSpec: StructuredTaskPlan['outputSpec'],
) {
  if (outputSpec.format === 'markdown') {
    const lines: string[] = ['# Crawl Results', '']
    for (const [idx, item] of items.entries()) {
      lines.push(`## ${idx + 1}. ${String(item?.title ?? '').trim() || 'Untitled'}`)
      lines.push(`- url: ${String(item?.url ?? '').trim()}`)
      const extra = Object.entries(item).filter(([k]) => !['title', 'url'].includes(k))
      for (const [k, v] of extra.slice(0, 8)) {
        lines.push(`- ${k}: ${String(v)}`)
      }
      lines.push('')
    }
    return lines.join('\n')
  }
  if (outputSpec.format === 'csv') {
    const keys = Array.from(new Set(items.flatMap((x) => Object.keys(x || {}))))
    const esc = (v: unknown) => {
      const s = String(v ?? '')
      if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
      return s
    }
    const rows = [keys.join(',')]
    for (const item of items) {
      rows.push(keys.map((k) => esc(item?.[k])).join(','))
    }
    return rows.join('\n')
  }
  return JSON.stringify(items, null, 2)
}
