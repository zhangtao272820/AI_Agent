/**
 * 总管 ↔ 子 Agent 协议 helper（Manager smoke / server 侧）。
 * SSOT：`shared/managerSubAgentProtocol.ts`（须与此处标记/剥离逻辑一致）；Nuxt 用 `#agent-shared`。
 */

/** 与 shared/managerSubAgentProtocol ADMIN_MANAGER_MARKERS 对齐 */
const ADMIN_MANAGER_MARKERS = [
  '【总管约束】',
  '【总管执行约束】',
  '【只读编排】',
  '（强制）不要等待人工确认',
  '已知信息（来自上游步骤',
  '仅处理下列个人助理能力'
] as const

const PLANNER_BLOCK_MARKERS = ['\n\n[约束', '\n\n[上下文', '\n\n[上游', '\n\n[步骤', '\n\n[总管'] as const

/** Admin WS / buildAdminStepQuery 前置说明行（非用户子任务） */
const ADMIN_PREAMBLE_LINE_PREFIXES = [
  '仅处理下列个人助理能力',
  '勿混入搜索',
  '勿混入知识库',
  '会议与日程须',
  '路线/地图问题必须',
  '路线/地图必须',
  '用户说「从这',
  '若已给出会议',
  '· 邮件',
  '· 联系人',
  '· 待办',
  '· 日程',
  '· 天气',
  '· 高德',
  '· 飞书',
  '【总管约束】',
  '【总管执行约束】',
  '【只读编排】',
  '（强制）不要等待人工确认',
  '已知信息（来自上游步骤'
] as const

function isAdminPreambleLine(line: string): boolean {
  const l = String(line || '').trim()
  if (!l) return true
  if (ADMIN_PREAMBLE_LINE_PREFIXES.some((p) => l.startsWith(p))) return true
  if (l.startsWith('· ')) return true
  return false
}

/** 按行拆分；若整段被逗号拼成一行且以 preamble 开头，再按中英文逗号切开 */
function splitAdminGuardCandidates(s: string): string[] {
  const byNl = s
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length >= 4)
  if (byNl.length > 1) return byNl
  const one = byNl[0] || s.trim()
  if (!one) return []
  if (isAdminPreambleLine(one) || one.includes('仅处理下列个人助理能力')) {
    const parts = one
      .split(/[，,]/)
      .map((p) => p.trim())
      .filter((p) => p.length >= 4)
    if (parts.length > 1) return parts
  }
  return byNl.length ? byNl : [one]
}

/** 剥离总管注入的 Admin guard / 上游块，保留真实子任务行（全部拼接，勿只取末行） */
export function stripAdminManagerGuards(raw: string): string {
  let s = String(raw ?? '').trim()
  if (!s) return ''

  // 尾部约束块：仅当标记出现在正文之后才截断（i>0）。
  // 旧逻辑 i>=0 会在「仅处理下列…」位于开头时把整段切成空串，导致 action_text 回退成带 guard 原文。
  for (const m of ADMIN_MANAGER_MARKERS) {
    const i = s.indexOf(m)
    if (i > 0) s = s.slice(0, i).trim()
  }
  for (const m of PLANNER_BLOCK_MARKERS) {
    const i = s.indexOf(m)
    if (i > 0) s = s.slice(0, i).trim()
  }

  const lines = splitAdminGuardCandidates(s)
  const taskish = lines.filter((l) => !isAdminPreambleLine(l))
  if (taskish.length) return taskish.join('，')
  if (lines.length) {
    const last = lines[lines.length - 1]!
    return isAdminPreambleLine(last) ? '' : last
  }
  return isAdminPreambleLine(s) ? '' : s
}

export const MANAGER_ORCHESTRATED_HEADER = 'x-manager-orchestrated'

export { ADMIN_MANAGER_MARKERS, PLANNER_BLOCK_MARKERS }
