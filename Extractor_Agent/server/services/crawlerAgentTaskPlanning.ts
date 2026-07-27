import { z } from 'zod'
import { buildRelativeRange, inferItemTimestamp, normalizeRequestedField } from './crawlerAgentTaskUtils'
import { getCapabilityProfile } from './capabilityRegistry'
import { getPatchAntiBotRisk } from './patchRegistry'
import { inferStructuralTaskPlan, mergeStructuralIntoTaskPlan } from './structural_task_infer'

type TaskPlanItem = Record<string, any>

export type StructuredTaskPlan = {
  targetSite: 'douban' | 'zhihu' | 'weibo' | 'bilibili' | 'toutiao' | 'douyin' | 'jd' | 'qqmusic' | 'kugou' | 'generic'
  contentType: 'ranking' | 'news' | 'products' | 'qa' | 'videos' | 'music' | 'generic'
  limit: number | null
  fields: string[]
  filters: string[]
  sortBy: string | null
  sortOrder: 'asc' | 'desc' | null
  timeRange: {
    from?: string
    to?: string
    relative?: string
  } | null
  outputSpec: {
    format: 'json' | 'csv' | 'markdown'
    language: string | null
    includeRaw: boolean
  }
  qualityTarget: {
    minFieldCoverage: number
    maxDupRate: number
  } | null
  needsAuth: boolean
  confidence: number
  /** 由任务解析 LLM 判定：无明确站点 URL 时是否可用公网搜索（如 Bing）作为入口 */
  openWebSearch: boolean
}

const TaskTimeRangeSchema = z
  .object({
    from: z.string().optional(),
    to: z.string().optional(),
    relative: z.string().optional()
  })
  .nullable()
  .default(null)

const OutputSpecSchema = z
  .object({
    format: z.enum(['json', 'csv', 'markdown']).default('json'),
    language: z.string().nullable().default(null),
    includeRaw: z.boolean().default(false)
  })
  .default({ format: 'json', language: null, includeRaw: false })

const QualityTargetSchema = z
  .object({
    minFieldCoverage: z.number().min(0).max(1).default(0.6),
    maxDupRate: z.number().min(0).max(1).default(0.3)
  })
  .nullable()
  .default(null)

export const StructuredTaskPlanSchema = z.object({
  targetSite: z.enum(['douban', 'zhihu', 'weibo', 'bilibili', 'toutiao', 'douyin', 'jd', 'qqmusic', 'kugou', 'generic']).default('generic'),
  contentType: z.enum(['ranking', 'news', 'products', 'qa', 'videos', 'music', 'generic']).default('generic'),
  limit: z.number().int().min(1).max(250).nullable().default(null),
  fields: z.array(z.string()).default(['title', 'url']),
  filters: z.array(z.string()).default([]),
  sortBy: z.string().nullable().default(null),
  sortOrder: z.enum(['asc', 'desc']).nullable().default(null),
  timeRange: TaskTimeRangeSchema,
  outputSpec: OutputSpecSchema,
  qualityTarget: QualityTargetSchema,
  needsAuth: z.boolean().default(false),
  confidence: z.number().min(0).max(1).default(0.5),
  openWebSearch: z.boolean().default(false)
})

/** 结构性推断 + 中性兜底（LLM 之前锁定已知榜单站点与数量） */
export function buildHeuristicStructuredTaskPlan(task: string): StructuredTaskPlan {
  const structural = inferStructuralTaskPlan(task)
  const neutral: StructuredTaskPlan = {
    targetSite: 'generic',
    contentType: 'generic',
    limit: null,
    fields: ['title', 'url'],
    filters: [],
    sortBy: null,
    sortOrder: null,
    timeRange: null,
    outputSpec: { format: 'json', language: null, includeRaw: false },
    qualityTarget: { minFieldCoverage: 0.6, maxDupRate: 0.3 },
    needsAuth: false,
    confidence: 0.35,
    openWebSearch: false,
  }
  return mergeStructuralIntoTaskPlan(neutral, structural)
}

export function detectTaskConflictsAndAmbiguity(_task: string, taskPlan: StructuredTaskPlan) {
  const issues: string[] = []
  const questions: string[] = []
  if (taskPlan.timeRange?.from && taskPlan.timeRange?.to) {
    const fromTs = Date.parse(taskPlan.timeRange.from)
    const toTs = Date.parse(taskPlan.timeRange.to)
    if (Number.isFinite(fromTs) && Number.isFinite(toTs) && fromTs > toTs) {
      issues.push('time_range_invalid')
      questions.push('时间范围开始时间晚于结束时间，请确认时间区间。')
    }
  }
  if (taskPlan.limit != null && taskPlan.limit > 200) {
    issues.push('limit_too_large')
    questions.push('你要求的数量较大（>200），请确认是否接受更长执行时间。')
  }
  return { issues, questions }
}

export function buildTaskPreflight(task: string, taskPlan: StructuredTaskPlan, seedUrls?: string[]) {
  const hasExplicitUrl = /https?:\/\/[^\s]+/i.test(String(task ?? ''))
  const hasSeedUrls = Array.isArray(seedUrls) && seedUrls.length > 0
  const hasSource = taskPlan.targetSite !== 'generic' || hasExplicitUrl || Boolean(taskPlan.openWebSearch) || hasSeedUrls
  const antiBotRisk: 'low' | 'medium' | 'high' =
    taskPlan.targetSite !== 'generic'
      ? getPatchAntiBotRisk(taskPlan.targetSite, taskPlan.contentType)
      : 'low'
  const blockers: string[] = []
  const warnings: string[] = []
  const suggestions: string[] = []
  if (!hasSource) {
    blockers.push('source_not_resolved')
    suggestions.push('请提供目标 URL 或明确站点名称，这样才能执行可控抓取。')
  }
  if (taskPlan.needsAuth) {
    warnings.push('auth_required')
    suggestions.push('该任务可能需要登录态，请准备账号会话或改用公开页面。')
  }
  if (taskPlan.contentType === 'generic') {
    warnings.push('generic_goal')
    suggestions.push('建议补充内容类型（如热榜、新闻、商品），可提升提取精度。')
  }
  return {
    executable: blockers.length === 0,
    antiBotRisk,
    estimatedCost: taskPlan.limit && taskPlan.limit > 50 ? 'medium' : 'low',
    blockers,
    warnings,
    suggestions
  }
}

export function applyTaskPlanFilters<T extends TaskPlanItem>(items: T[], taskPlan: StructuredTaskPlan) {
  const source = Array.isArray(items) ? items : []
  let filtered = source
  const warnings: string[] = []

  if (taskPlan.timeRange?.from || taskPlan.timeRange?.to || taskPlan.timeRange?.relative) {
    let fromTs: number | null = null
    let toTs: number | null = null
    if (taskPlan.timeRange?.from) {
      const v = Date.parse(taskPlan.timeRange.from)
      if (Number.isFinite(v)) fromTs = v
    }
    if (taskPlan.timeRange?.to) {
      const v = Date.parse(taskPlan.timeRange.to)
      if (Number.isFinite(v)) toTs = v
    }
    if (taskPlan.timeRange?.relative && fromTs === null && toTs === null) {
      const rel = buildRelativeRange(taskPlan.timeRange.relative)
      if (rel) {
        fromTs = rel.from
        toTs = rel.to
      }
    }
    if (fromTs !== null || toTs !== null) {
      const beforeCount = filtered.length
      filtered = filtered.filter((item) => {
        const ts = inferItemTimestamp(item)
        if (ts === null) return true
        if (fromTs !== null && ts < fromTs) return false
        if (toTs !== null && ts > toTs) return false
        return true
      })
      const removed = beforeCount - filtered.length
      if (removed > 0) warnings.push(`已按时间范围过滤 ${removed} 条数据`)
    } else {
      warnings.push('任务包含时间范围要求，但未识别到可用时间字段，已跳过时间过滤')
    }
  }

  return { items: filtered, warnings }
}

export {
  computeResultQuality,
  passBuiltinListingQuality,
  resolveQualityCheckFields,
  evaluateCrawlRun,
  resolveMinItems,
  formatItemsByOutputSpec,
} from '../core/verify/qualityGate'
