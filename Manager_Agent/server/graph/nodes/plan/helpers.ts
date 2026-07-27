import { isAdminBlockedForState } from '../../core/db/writeGate'

export const PLANNER_RULES_FALLBACK =
  '你是 Planner：为 multi 任务输出 steps JSON；遵守 dependsOn/parallelGroup；allowedAgents 为白名单 cap，只规划用户真正需要的步骤；硬规则：visualize/report 需 code，多源对比需 clean'

export function stripAdminStepsIfBlocked(plan: any[], state: { meta?: unknown }) {
  if (!isAdminBlockedForState(state)) return plan
  return plan.filter((s) => String(s?.agent || '') !== 'admin')
}
