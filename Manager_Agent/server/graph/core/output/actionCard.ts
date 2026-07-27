/**
 * D3 ActionCard：拟执行动作卡（admin / gui），确认后仍走现有 Gate/resume。
 */
import type { UserFacingActionCard } from './userFacingPayload'

const FAILURE_ZH: Record<string, string> = {
  captcha: '需要完成验证码',
  need_login: '需要登录后继续',
  need_human: '需要你确认后继续',
  timeout: '操作超时，请重试或改步骤',
  blocked: '页面拦截了自动操作',
  permission: '权限不足，无法继续'
}

export function failureReasonZh(code: string): string {
  const k = String(code || '')
    .trim()
    .toLowerCase()
  if (!k) return '执行未完成，请确认后重试'
  return FAILURE_ZH[k] || '执行遇到问题，请确认后重试'
}

export function buildAdminWriteActionCard(input: {
  id?: string
  summary: string
  risk?: 'low' | 'mid' | 'high'
  status?: UserFacingActionCard['status']
  ops?: string[]
}): UserFacingActionCard {
  const ops = (Array.isArray(input.ops) ? input.ops : []).map((x) => String(x).trim()).filter(Boolean)
  const summary =
    String(input.summary || '').trim() ||
    (ops.length ? `拟执行：${ops.join('、')}` : '拟执行个人事务写操作')
  return {
    id: String(input.id || `admin_${Date.now()}`).slice(0, 80),
    kind: 'admin_write',
    title: '办公写操作',
    summary: summary.slice(0, 400),
    risk: input.risk || 'high',
    status: input.status || 'awaiting_confirm'
  }
}

export function buildGuiAutomateActionCard(input: {
  id?: string
  title?: string
  summary: string
  risk?: 'low' | 'mid' | 'high'
  status?: UserFacingActionCard['status']
  screenshotUrl?: string
  pageUrl?: string
  failureType?: string
}): UserFacingActionCard {
  const fail = String(input.failureType || '').trim()
  return {
    id: String(input.id || `gui_${Date.now()}`).slice(0, 80),
    kind: 'gui_automate',
    title: String(input.title || '浏览器操作').slice(0, 80),
    summary: String(input.summary || '拟执行浏览器自动化步骤').slice(0, 400),
    risk: input.risk || 'high',
    status: input.status || 'awaiting_confirm',
    preview: {
      ...(input.screenshotUrl ? { screenshotUrl: String(input.screenshotUrl) } : {}),
      ...(input.pageUrl ? { pageUrl: String(input.pageUrl) } : {})
    },
    ...(fail ? { failureReasonZh: failureReasonZh(fail) } : {})
  }
}

/** 从 HITL / meta 组装本轮待确认动作卡 */
export function buildActionCardsFromHumanConfirm(input: {
  agent?: string
  title?: string
  message?: string
  confirmId?: string
  screenshotDataUrl?: string
  pageUrl?: string
  failureType?: string
  adminPendingOps?: unknown[]
}): UserFacingActionCard[] {
  const agent = String(input.agent || 'admin').toLowerCase()
  const confirmId = String(input.confirmId || '').trim()
  const message = String(input.message || '').trim()
  if (agent === 'gui') {
    return [
      buildGuiAutomateActionCard({
        id: confirmId || undefined,
        title: String(input.title || '浏览器操作'),
        summary: message || '拟执行浏览器自动化',
        screenshotUrl: input.screenshotDataUrl,
        pageUrl: input.pageUrl,
        failureType: input.failureType,
        status: 'awaiting_confirm'
      })
    ]
  }
  const ops = Array.isArray(input.adminPendingOps)
    ? input.adminPendingOps.map((x) => String(x ?? '').trim()).filter(Boolean)
    : []
  return [
    buildAdminWriteActionCard({
      id: confirmId || undefined,
      summary: message || (ops.length ? `拟执行：${ops.join('、')}` : '拟执行个人事务写操作'),
      ops,
      status: 'awaiting_confirm',
      risk: 'high'
    })
  ]
}
