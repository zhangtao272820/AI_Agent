/**
 * 经验写入质量门控：高分 experience 须通过审计/证据/用户确认，避免脏样本进入进化闭环。
 */

import { resolveManagerEnvBool } from '../../../utils/platform/managerEnvModes'

const HIGH_SUCCESS_THRESHOLD = 0.72

function isFederationFeedbackGated(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.MGR_FEDERATION_REQUIRE_FEEDBACK ?? '1').trim() !== '0'
}

export type ExperienceWriteContext = {
  successScore: number
  failureCategory: string
  needsClarify: boolean
  feedbackScore?: number | null
  retryCount?: number
  routeConfidence?: number
  finalConfidence?: number
  evidenceSupportedClaimRate?: number | null
  evidenceGatePassed?: boolean
  hasSubstantialFinal?: boolean
  routeMatrixPass?: boolean
  orchestratorJudgeAccept?: boolean
}

export function isStrictExperienceWriteEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.MANAGER_STRICT_EXPERIENCE_WRITE ?? '1').trim() !== '0'
}

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n))
}

/** 是否满足「高质量成功经验」写入条件（用于联邦 sync / skill draft / 高分 memory） */
export function qualifiesHighQualityExperience(ctx: ExperienceWriteContext, env: NodeJS.ProcessEnv = process.env): boolean {
  if (resolveManagerEnvBool('MANAGER_EXPERIENCE_REQUIRES_ROUTE_PASS', env) && ctx.routeMatrixPass === false) return false
  if (resolveManagerEnvBool('MANAGER_EXPERIENCE_REQUIRES_JUDGE_ACCEPT', env) && ctx.orchestratorJudgeAccept === false) return false

  const fb = typeof ctx.feedbackScore === 'number' && Number.isFinite(ctx.feedbackScore) ? ctx.feedbackScore : null
  if (fb != null && fb >= 0.78) return true

  if (ctx.needsClarify) return false
  if (String(ctx.failureCategory || '') !== 'success') return false
  if (Number(ctx.retryCount ?? 0) > 0) return false

  const claimRate =
    typeof ctx.evidenceSupportedClaimRate === 'number' && Number.isFinite(ctx.evidenceSupportedClaimRate)
      ? ctx.evidenceSupportedClaimRate
      : null
  if (claimRate != null && claimRate >= 0.68) return true
  if (ctx.evidenceGatePassed === true) return true

  const route = Number(ctx.routeConfidence ?? 0)
  const final = Number(ctx.finalConfidence ?? 0)
  if (ctx.hasSubstantialFinal && route >= 0.82 && final >= 0.82) return true

  return false
}

/** 调整写入 memory 的 successScore，并标记是否可参与联邦/Skill 蒸馏 */
export function refineExperienceWrite(ctx: ExperienceWriteContext, env: NodeJS.ProcessEnv = process.env): {
  successScore: number
  qualifiedHighQuality: boolean
  cappedForLearning: boolean
} {
  let successScore = clamp01(Number(ctx.successScore ?? 0))
  const qualified = qualifiesHighQualityExperience(ctx, env)
  const strict = isStrictExperienceWriteEnabled(env)
  let cappedForLearning = false

  if (strict && successScore >= HIGH_SUCCESS_THRESHOLD && !qualified) {
    successScore = Math.min(successScore, HIGH_SUCCESS_THRESHOLD - 0.06)
    cappedForLearning = true
  }

  return { successScore, qualifiedHighQuality: qualified, cappedForLearning }
}

/** Skill 自动 draft：联邦门控下须用户确认或高质量门禁通过 */
export function skillDraftRequiresUserConfirm(env: NodeJS.ProcessEnv = process.env): boolean {
  if (!isFederationFeedbackGated(env)) return false
  return String(env.MGR_SKILL_DRAFT_REQUIRE_CONFIRM ?? '1').trim() !== '0'
}

export function qualifiesSkillAutoDraft(ctx: ExperienceWriteContext, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!skillDraftRequiresUserConfirm(env)) return true
  const fb = typeof ctx.feedbackScore === 'number' ? ctx.feedbackScore : null
  if (fb != null && fb > 0) return true
  return qualifiesHighQualityExperience(ctx, env)
}

/** 向量经验 memory 是否可入库（路由矩阵 + Judge + 质量门） */
export function shouldIndexExperienceMemory(
  ctx: ExperienceWriteContext & { successScore: number },
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (!qualifiesHighQualityExperience(ctx, env)) return false
  const min = Number(env.MANAGER_EXPERIENCE_INDEX_MIN_SCORE ?? '0.72')
  const threshold = Number.isFinite(min) ? Math.max(0.5, Math.min(0.95, min)) : 0.72
  return ctx.successScore >= threshold
}
