import { looksLikeRiskyAdminWrite } from '#agent-shared/textMarkers'
import {
  inferActionKindFromAgent,
  resolveRiskExecutionPolicy
} from '../policy/riskExecutionPolicy'

/** 高风险 admin 写操作闸门：默认需人工确认；自治 run 禁止写操作 */

export function isAdminWriteGateEnabled() {
  return String(process.env.MANAGER_ADMIN_WRITE_GATE ?? '1').trim() !== '0'
}

export function isAutonomousRunMeta(meta: unknown): boolean {
  if (!meta || typeof meta !== 'object') return false
  return Boolean((meta as Record<string, unknown>).autonomousRun)
}

export function isAdminBlockedForState(state: { meta?: unknown } | null | undefined): boolean {
  if (!isAdminWriteGateEnabled()) return false
  const meta = state?.meta as Record<string, unknown> | undefined
  if (meta?.allowRiskyWrites === true) return false
  if (meta?.blockAdminWrites === true || isAutonomousRunMeta(meta)) return true
  return false
}

export function isRiskyAdminQuery(text: string): boolean {
  return looksLikeRiskyAdminWrite(String(text || ''))
}

const ADMIN_READ_ONLY_ORCH = /提炼|归纳|解释|汇总|回复|说明|整理|分析|协助|消除.*干扰|核心事实|处理结果/i
const ADMIN_WRITE_ORCH = /创建|存放|临时文件夹|会话策略|写入|保存到|设置会话|新建|添加待办|发邮件|安排会议|预约/

/** 总管编排：仅归纳/回复类 admin 步骤无需 UI 二次确认 */
export function isAdminReadOnlyOrchestrationStep(stepQuery: string): boolean {
  const q = String(stepQuery || '').trim()
  if (!q) return false
  if (ADMIN_WRITE_ORCH.test(q)) return false
  if (isRiskyAdminQuery(q)) return false
  return ADMIN_READ_ONLY_ORCH.test(q)
}

/** admin 调用是否自动确认高风险工具（写闸开启时默认需 UI 确认，除非本会话已 allowRiskyWrites） */
export function resolveAdminAutoConfirm(
  state: { meta?: unknown } | null | undefined,
  stepQuery?: string
): boolean {
  if (!isAdminWriteGateEnabled()) return true
  const meta = state?.meta as Record<string, unknown> | undefined
  if (meta?.allowRiskyWrites === true) return true
  if (meta?.blockAdminWrites === true || isAutonomousRunMeta(meta)) return false
  const q = String(stepQuery || '').trim()
  const readOnly = q ? isAdminReadOnlyOrchestrationStep(q) : false
  const policy = resolveRiskExecutionPolicy({
    actionKind: inferActionKindFromAgent('admin', { readOnly: readOnly || (q ? !isRiskyAdminQuery(q) : false) }),
    meta: state?.meta,
    securityRiskLevel:
      meta?.security && typeof meta.security === 'object'
        ? ((meta.security as { riskLevel?: 'low' | 'medium' | 'high' }).riskLevel as
            | 'low'
            | 'medium'
            | 'high'
            | undefined)
        : undefined,
    worldModelRisk: Number(meta?.worldModelRisk ?? 0)
  })
  if (!policy.allowAutoConfirm) return false
  // 非写操作（路线/天气/查询类）无需 UI 二次确认
  if (q && !isRiskyAdminQuery(q)) return true
  if (q && isAdminReadOnlyOrchestrationStep(q)) return true
  return false
}

export function filterAgentsRespectingWriteGate<T extends string>(
  agents: T[],
  state: { meta?: unknown } | null | undefined
): T[] {
  let out = agents
  if (isAdminBlockedForState(state)) {
    out = out.filter((a) => a !== 'admin') as T[]
  }
  if (isGuiBlockedForState(state)) {
    out = out.filter((a) => a !== 'gui') as T[]
  }
  return out
}

export function isGuiWriteGateEnabled() {
  return String(process.env.MANAGER_GUI_WRITE_GATE ?? '1').trim() !== '0'
}

export function isGuiBlockedForState(state: { meta?: unknown } | null | undefined): boolean {
  if (!isGuiWriteGateEnabled()) return false
  const meta = state?.meta as Record<string, unknown> | undefined
  if (meta?.allowGui === true) return false
  if (meta?.blockGuiWrites === true || isAutonomousRunMeta(meta)) return true
  return false
}

export function writeGateRouterHint(state: { meta?: unknown } | null | undefined): string {
  const parts: string[] = []
  if (isAdminBlockedForState(state)) {
    parts.push(
      '【写操作闸门】',
      '本会话为自治推进或已启用写操作保护：禁止规划/执行 admin 写操作（创建待办、发邮件、改日程等）。',
      '仅允许查询、归纳、建议下一步；若用户明确要求写操作，需在前端点击「确认」后继续。'
    )
  }
  if (isGuiBlockedForState(state)) {
    parts.push(
      '【GUI 闸门】',
      '本会话禁止 GUI 浏览器自动化（登录/填表/点击等交互操作）；仅允许静态抓取 crawler 或联网检索。'
    )
  }
  return parts.join('\n')
}
