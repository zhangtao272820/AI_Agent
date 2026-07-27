/**
 * 长任务分 phase：当前 phase 步用尽后，LLM 决定是否开启下一 phase（≤8 步）。
 * 不抬高单 plan 的 TaskPlanSchema.max(8)；禁止关键词路由。
 */
import { z } from 'zod'
import type { Step } from '../../../utils/shared/taskPlan'
import { StepSchema } from '../../../utils/shared/taskPlan'
import { safeJsonParse } from '../shared/llmJson'
import type { LlmInvokeFn } from '../../llm/taskConstraintsLlm'

const PhaseContinueSchema = z.object({
  continuePhase: z.boolean(),
  confidence: z.number().min(0).max(1).optional(),
  reason: z.string().max(400).optional(),
  nextSteps: z
    .array(
      z.object({
        id: z.string().min(1).max(80).optional(),
        agent: StepSchema.shape.agent,
        query: z.string().min(1).max(2000),
        dependsOn: z.array(z.string().min(1)).optional(),
        optional: z.boolean().optional()
      })
    )
    .max(8)
    .optional()
})

export type PhaseContinueDecision = z.infer<typeof PhaseContinueSchema>

export function maxRunPhases(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.MANAGER_MAX_RUN_PHASES ?? '3')
  return Number.isFinite(n) && n >= 1 ? Math.min(6, Math.floor(n)) : 3
}

export function phaseStepBudget(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.MANAGER_PHASE_STEP_BUDGET ?? '8')
  return Number.isFinite(n) && n >= 1 ? Math.min(8, Math.floor(n)) : 8
}

/**
 * 当前 phase 结束后判断是否续 phase。
 * confidence < 0.5 或 continuePhase=false → null
 */
export async function llmPhaseContinue(opts: {
  llmInvoke: LlmInvokeFn
  state: unknown
  question: string
  runPhase: number
  maxPhases: number
  completedSummaries: Array<{ id: string; agent: string; status: string; summary: string }>
  planConstraints?: string
}): Promise<{ reason: string; nextSteps: Step[]; nextPhase: number } | null> {
  const runPhase = Math.max(1, Math.floor(Number(opts.runPhase) || 1))
  const maxPhases = Math.max(1, opts.maxPhases)
  if (runPhase >= maxPhases) return null

  const budget = phaseStepBudget()
  const doneLines = opts.completedSummaries
    .map((s) => `- ${s.id} [${s.agent}/${s.status}] ${s.summary.slice(0, 120)}`)
    .join('\n')

  try {
    const r = await opts.llmInvoke(
      'plan',
      opts.state,
      [
        [
          'system',
          [
            '你是长任务 phase 续规划官。当前执行 phase 的步骤已全部完成（或预算用尽）。',
            '判断用户目标是否仍需下一 phase 的新步骤；单跳简单问答应 continuePhase=false。',
            '只输出严格 JSON：',
            '{"continuePhase":boolean,"confidence":0-1,"reason":"...","nextSteps":[{"id":"...","agent":"db|rag|...","query":"...","dependsOn":[],"optional":false}]}',
            '规则：',
            '- 仅当目标明显未完成且需要更多工具步骤时 continuePhase=true',
            `- nextSteps 条数 1..${budget}；agent 必须是已有能力；禁止编造权威数字`,
            '- confidence<0.5 视为不续 phase'
          ].join('\n')
        ],
        [
          'human',
          [
            `用户目标：${String(opts.question || '').slice(0, 800)}`,
            opts.planConstraints ? `用户约束：${opts.planConstraints.slice(0, 400)}` : '',
            `当前 phase=${runPhase} / max=${maxPhases}`,
            `已完成步骤：\n${doneLines || '（无）'}`,
            `若 continuePhase=true，给出下一 phase 的 nextSteps（≤${budget}）。`
          ]
            .filter(Boolean)
            .join('\n\n')
        ]
      ],
      { thinkingLabel: '评估是否续 phase' }
    )

    const parsed = PhaseContinueSchema.safeParse(safeJsonParse(String(r.text || '').trim()))
    if (!parsed.success) return null
    if (!parsed.data.continuePhase) return null
    if (Number(parsed.data.confidence ?? 0) < 0.5) return null
    const rawSteps = Array.isArray(parsed.data.nextSteps) ? parsed.data.nextSteps : []
    if (!rawSteps.length) return null

    const nextPhase = runPhase + 1
    const nextSteps: Step[] = []
    const usedIds = new Set(opts.completedSummaries.map((c) => c.id))
    for (const raw of rawSteps.slice(0, budget)) {
      const agent = raw.agent
      let id = String(raw.id || '').trim() || `p${nextPhase}_${agent}_${nextSteps.length + 1}`
      while (usedIds.has(id)) id = `${id}_${nextSteps.length + 1}`
      usedIds.add(id)
      const query = String(raw.query || '').trim()
      if (!query) continue
      nextSteps.push({
        id,
        agent,
        query: query.slice(0, 2000),
        dependsOn: Array.isArray(raw.dependsOn) ? raw.dependsOn.filter(Boolean).slice(0, 6) : undefined,
        optional: Boolean(raw.optional)
      })
    }
    if (!nextSteps.length) return null
    return {
      reason: String(parsed.data.reason || 'phase_continue').slice(0, 400),
      nextSteps,
      nextPhase
    }
  } catch {
    return null
  }
}
