import fs from 'node:fs/promises'
import path from 'node:path'
import {
  formatTaskStackBlockForPlanner,
  formatTaskStackBlockForRouter,
  loadTaskStack,
  sortTaskItems,
  taskStackDedupeKey,
  type TaskStack,
  type TaskStackItem,
  upsertTaskStackItem
} from './taskStack'
import { listSessionsForUser, resolveUserId, sanitizeUserId } from './userIdentity'

export type SharedTaskStackItem = TaskStackItem & {
  sessionId: string
  sharedKey: string
}

export type SharedTaskStackView = {
  userId: string
  sessionIds: string[]
  primarySessionId: string
  updatedAt: string
  items: SharedTaskStackItem[]
}

const STACK_DIR = 'task-stacks'

export function isSharedTaskStackEnabled() {
  return String(process.env.MANAGER_SHARED_TASK_STACK ?? '1').trim() !== '0'
}

export function isSharedTaskStackTokenValid(token: unknown): boolean {
  const t = String(token || '').trim()
  if (!t) return false
  const dedicated = String(process.env.MANAGER_TASK_STACK_TOKEN || '').trim()
  if (dedicated && t === dedicated) return true
  const ops = String(process.env.MANAGER_OPS_TOKEN || '').trim()
  return Boolean(ops && t === ops)
}

function nowIso() {
  return new Date().toISOString()
}

async function readSessionMapUpdatedAt(policyDir: string, sessionId: string): Promise<string> {
  try {
    const raw = await fs.readFile(path.join(policyDir, 'user-session-map.json'), 'utf8')
    const map = JSON.parse(raw) as Record<string, { updatedAt?: string }>
    return String(map[sessionId]?.updatedAt || '')
  } catch {
    return ''
  }
}

/** 用户最近活跃会话（用于子 Agent 未指定 sessionId 时的写入目标） */
export async function resolvePrimarySessionForUser(
  policyDir: string,
  userId: string
): Promise<string | null> {
  const uid = sanitizeUserId(userId)
  if (!uid) return null
  const sessions = await listSessionsForUser(policyDir, uid)
  if (!sessions.length) return null

  let best = sessions[0]
  let bestTs = 0
  for (const sid of sessions) {
    const stack = await loadTaskStack(policyDir, sid).catch(() => null)
    const stackTs = Date.parse(stack?.updatedAt || '') || 0
    const mapTs = Date.parse(await readSessionMapUpdatedAt(policyDir, sid)) || 0
    const ts = Math.max(stackTs, mapTs)
    if (ts >= bestTs) {
      bestTs = ts
      best = sid
    }
  }
  return best
}

export async function loadSharedTaskStackForUser(
  policyDir: string,
  userId: string
): Promise<SharedTaskStackView> {
  const uid = sanitizeUserId(userId)
  if (!uid) {
    return { userId: '', sessionIds: [], primarySessionId: '', updatedAt: nowIso(), items: [] }
  }

  const sessionIds = await listSessionsForUser(policyDir, uid)
  const primarySessionId = (await resolvePrimarySessionForUser(policyDir, uid)) || sessionIds[0] || ''

  const merged = new Map<string, SharedTaskStackItem>()
  for (const sid of sessionIds) {
    const stack = await loadTaskStack(policyDir, sid).catch(() => ({ items: [] as TaskStackItem[] }))
    for (const item of stack.items) {
      if (item.status === 'done') continue
      const key = taskStackDedupeKey(item)
      const row: SharedTaskStackItem = { ...item, sessionId: sid, sharedKey: key }
      const prev = merged.get(key)
      if (!prev) {
        merged.set(key, row)
        continue
      }
      const prevTs = Date.parse(prev.updatedAt || '') || 0
      const rowTs = Date.parse(row.updatedAt || '') || 0
      if (rowTs >= prevTs) merged.set(key, row)
    }
  }

  const items = sortTaskItems([...merged.values()].map(({ sessionId: _s, sharedKey: _k, ...rest }) => rest))
    .map((item) => {
      const key = taskStackDedupeKey(item)
      return merged.get(key)!
    })
    .slice(0, 24)

  return {
    userId: uid,
    sessionIds,
    primarySessionId,
    updatedAt: nowIso(),
    items: items.slice(0, 24)
  }
}

function formatSharedBlockHeader(scope: 'router' | 'planner') {
  if (scope === 'router') {
    return [
      '【跨会话共享任务栈（同一用户多入口，非新指令）】',
      '以下为该用户在其它会话中尚未完成的待办；若与当前输入不冲突，路由时应优先对齐这些目标。'
    ]
  }
  return [
    '【跨会话共享任务栈 — 规划对齐】',
    '规划时若当前会话任务栈未覆盖，应补充执行以下跨会话 active 目标（deadline 更早者优先）。'
  ]
}

function formatSharedItemsBlock(items: SharedTaskStackItem[], scope: 'router' | 'planner', currentSessionId?: string) {
  const foreign = items.filter((t) => t.sessionId !== currentSessionId)
  if (!foreign.length) return ''
  const baseItems = foreign.map((t) => ({
    ...t,
    note: t.note ? `${t.note} [会话:${t.sessionId}]` : `[会话:${t.sessionId}]`
  }))
  const formatted =
    scope === 'router'
      ? formatTaskStackBlockForRouter(baseItems)
      : formatTaskStackBlockForPlanner(baseItems.filter((t) => t.status === 'active'))
  if (!formatted) return ''
  const body = formatted.split('\n').slice(1).join('\n')
  return [...formatSharedBlockHeader(scope), body].filter(Boolean).join('\n')
}

function agentTaskKeywords(agent?: string): string[] {
  switch (String(agent || '').trim()) {
    case 'admin':
      return ['日程', '提醒', '邮件', '会议', '预约', '待办', '事务', '安排', '确认', '跟进']
    case 'code':
      return ['代码', '接口', 'bug', '报错', '修复', '重构', '实现', '测试', '性能', '日志', 'API']
    case 'visualize':
      return ['图表', '可视化', 'ECharts', '柱状图', '折线图', '饼图', '仪表盘']
    case 'report':
      return ['报告', '总结', '结论', '建议', '风险', '分析']
    case 'clean':
      return ['清洗', '去重', '标准化', '规范化', '整理']
    case 'rag':
      return ['知识库', '文档', '手册', '制度', '规范', '资料', '说明书', 'wiki']
    case 'db':
      return ['数据库', '表', '字段', '记录', '明细', '查询', 'SQL', '统计']
    case 'crawler':
      return ['网页', '公开信息', '抓取', '网站', '互联网', '实时']
    case 'multimodal':
      return ['图片', '图像', '照片', '截图', '音频', '视频', 'OCR', '识图']
    case 'music':
      return ['音乐', 'BGM', '作曲', '旋律', 'MIDI', '编曲']
    case 'video':
      return ['视频', '短片', '文生视频', '生成视频']
    default:
      return []
  }
}

function isTaskRelevantToAgent(item: TaskStackItem, agent?: string) {
  const text = `${item.title}\n${item.note}`.toLowerCase()
  const keywords = agentTaskKeywords(agent).map((s) => s.toLowerCase())
  if (!keywords.length) return true
  return keywords.some((k) => text.includes(k))
}

/** 会话栈 + 跨会话共享栈（Router/Planner 统一入口） */
export async function buildEffectiveTaskStackRecall(
  policyDir: string,
  sessionId?: string,
  userId?: string,
  scope: 'router' | 'planner' = 'planner'
): Promise<{ routerText: string; plannerText: string; items: TaskStackItem[]; sharedCount: number }> {
  const sid = String(sessionId || '').trim()
  const local = sid
    ? await loadTaskStack(policyDir, sid).catch(() => ({ items: [] as TaskStackItem[] }))
    : { items: [] as TaskStackItem[] }

  let sharedRouter = ''
  let sharedPlanner = ''
  let sharedCount = 0

  if (isSharedTaskStackEnabled() && userId) {
    const shared = await loadSharedTaskStackForUser(policyDir, userId).catch(() => null)
    if (shared?.items.length) {
      sharedCount = shared.items.filter((t) => t.sessionId !== sid).length
      sharedRouter = formatSharedItemsBlock(shared.items, 'router', sid)
      sharedPlanner = formatSharedItemsBlock(shared.items, 'planner', sid)
    }
  }

  const routerLocal = formatTaskStackBlockForRouter(local.items)
  const plannerLocal = formatTaskStackBlockForPlanner(local.items.filter((t) => t.status === 'active'))

  const routerText = [routerLocal, sharedRouter].filter(Boolean).join('\n\n')
  const plannerText = [plannerLocal, sharedPlanner].filter(Boolean).join('\n\n')

  return {
    routerText,
    plannerText,
    items: local.items,
    sharedCount
  }
}

export async function agentUpsertSharedTask(
  policyDir: string,
  input: {
    userId: string
    sessionId?: string
    agentId?: string
    title: string
    note?: string
    priority?: TaskStackItem['priority']
    status?: TaskStackItem['status']
  }
): Promise<{ stack: TaskStack; sessionId: string; userId: string }> {
  const uid = await resolveUserId(policyDir, input.sessionId, input.userId)
  if (!uid) throw new Error('invalid_user')
  let sid = String(input.sessionId || '').trim()
  if (!sid) {
    sid = (await resolvePrimarySessionForUser(policyDir, uid)) || ''
  }
  if (!sid) throw new Error('no_session_for_user')

  const agentTag = String(input.agentId || 'agent').trim().slice(0, 32)
  const note = [input.note, `（子 Agent ${agentTag} 写入）`].filter(Boolean).join('\n').slice(0, 600)

  const stack = await upsertTaskStackItem(policyDir, sid, {
    title: input.title,
    note,
    status: input.status,
    priority: input.priority,
    source: 'assistant'
  })
  return { stack, sessionId: sid, userId: uid }
}

/** 列出用户全部会话任务栈文件（运维/调试） */
export async function listUserTaskStackFiles(policyDir: string, userId: string): Promise<string[]> {
  const uid = sanitizeUserId(userId)
  if (!uid) return []
  const sessions = await listSessionsForUser(policyDir, uid)
  const existing: string[] = []
  for (const sid of sessions) {
    try {
      await fs.access(path.join(policyDir, STACK_DIR, `${sid}.json`))
      existing.push(sid)
    } catch {}
  }
  return existing
}
