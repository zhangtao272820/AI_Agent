/**
 * Classic 逐步决策 Schema（P3-L1）
 * 与 intentSchema 对齐；expect/confidence 供 StepDecide 自用与观测。
 * 完成态以 task-level successCriteria（lobsterSuccessCriteria）为准，勿依赖逐步 expect 落库。
 */

import { z } from 'zod'

export const ClassicStepIntentSchema = z.enum([
  'goto',
  'search',
  'open_first_result',
  'click_candidate',
  'type_into',
  'scroll',
  'wait',
  'paginate_next',
  'extract_items',
  'perform',
  'play',
  'like',
  'coin',
  'follow',
  'favorite',
  'click_by_bbox',
  'click_by_text',
  'dismiss_overlays',
  'reload',
  'back',
  'need_crawl',
  'done',
])

/** 下一步期望（结果态契约，非用户原话 regex） */
export const ClassicStepExpectSchema = z
  .object({
    urlIncludes: z.array(z.string().min(1).max(120)).max(6).optional(),
    urlMatches: z.string().max(200).optional(),
    stageHint: z.enum(['home', 'search', 'list', 'detail', 'play', 'unknown']).optional(),
    selectorPresent: z.string().max(120).optional(),
    extractMin: z.number().int().min(0).max(50).optional(),
  })
  .passthrough()

export const ClassicStepDecideSchema = z.object({
  intent: ClassicStepIntentSchema,
  args: z.record(z.string(), z.any()).optional(),
  reason: z.string().max(240).default(''),
  expect: ClassicStepExpectSchema.optional(),
  confidence: z.number().min(0).max(1).default(0.7),
})

export type ClassicStepDecideParsed = z.infer<typeof ClassicStepDecideSchema>
export type ClassicStepExpect = z.infer<typeof ClassicStepExpectSchema>

export function isClassicStepDecideEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.LOBSTER_CLASSIC_STEP_DECIDE ?? '1').trim() !== '0'
}

export function isClassicGoalsHeuristicEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.LOBSTER_CLASSIC_GOALS_HEURISTIC ?? '0').trim() === '1'
}

export function classicStepDecideMinConfidence(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.LOBSTER_STEP_DECIDE_MIN_CONF ?? 0.5)
  return Number.isFinite(n) ? Math.max(0.35, Math.min(0.95, n)) : 0.5
}

export function isResultPageGateEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.LOBSTER_RESULT_PAGE_GATE ?? '1').trim() !== '0'
}

export function isEngineTruthLogEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.LOBSTER_ENGINE_TRUTH_LOG ?? '1').trim() !== '0'
}
