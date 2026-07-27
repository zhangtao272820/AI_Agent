import {
  loadTaskStack,
  setTaskStackStatus,
  deleteTaskStackItem,
  upsertTaskStackItem,
  type TaskPriority,
  type TaskStack,
  type TaskStackItem
} from './taskStack'

export type TaskStackIngestResult =
  | { kind: 'add'; title: string; priority: TaskPriority; deadline?: string }
  | { kind: 'done'; title: string }
  | { kind: 'delete'; title: string }
  | { kind: 'none' }

export function isTaskStackAutoIngestEnabled() {
  return String(process.env.MANAGER_TASK_STACK_AUTO_INGEST ?? '1').trim() !== '0'
}

export function isTaskStackRouterExtractEnabled() {
  return String(process.env.MANAGER_TASK_STACK_ROUTER_EXTRACT ?? '1').trim() !== '0'
}

const QUERY_MARKERS = ['待办', '任务栈'] as const
const QUERY_ACTION_MARKERS = ['查看', '列出', '显示', '有哪些', '查询', '看看', '打开', '导出'] as const
const QUERY_LIST_MARKERS = ['列表', '清单', '情况'] as const

function looksLikeTaskStackQuery(text: string): boolean {
  const t = text.trim()
  if (!QUERY_MARKERS.some((m) => t.includes(m))) return false
  if (QUERY_ACTION_MARKERS.some((m) => t.includes(m))) return true
  if (QUERY_LIST_MARKERS.some((m) => t.includes(m))) return true
  if (t.endsWith('吗') || t.endsWith('吗?') || t.endsWith('吗？')) return true
  return false
}

const TODO_LINE_PREFIXES = ['待办：', '待办:', 'TODO:', 'TODO：', 'todo:', 'todo：'] as const

function parseTodoLineTitle(text: string): string | null {
  const t = text.trim()
  for (const p of TODO_LINE_PREFIXES) {
    if (t.toLowerCase().startsWith(p.toLowerCase())) {
      return t.slice(p.length).trim()
    }
  }
  return null
}

function parsePriorityStructural(text: string): TaskPriority {
  const markers: Partial<Record<TaskPriority, readonly string[]>> = {
    critical: ['紧急', 'critical', '最高优', '立刻', '马上', '尽快'],
    high: ['高优', '优先', 'important'],
    low: ['低优', '不急'],
  }
  const t = text.toLowerCase()
  if (markers.critical?.some((m) => t.includes(m.toLowerCase()))) return 'critical'
  if (markers.high?.some((m) => t.includes(m.toLowerCase()))) return 'high'
  if (markers.low?.some((m) => t.includes(m.toLowerCase()))) return 'low'
  return 'high'
}

function parseDeadline(text: string): string | undefined {
  const t = text
  const relWords = ['今天', '明日', '明天', '后天', '本周', '下周', '本周五', '下周五'] as const
  let word: string | undefined
  if (t.includes('截止') || t.includes('deadline') || t.includes('之前') || t.includes('前完成')) {
    word = relWords.find((w) => t.includes(w))
  }
  if (!word) {
    word = relWords.find((w) => {
      const i = t.indexOf(w)
      if (i < 0) return false
      const tail = t.slice(i + w.length, i + w.length + 6)
      return tail.includes('前') || tail.includes('之前') || tail.includes('内')
    })
  }
  if (!word) return undefined
  const now = new Date()
  const end = new Date(now)
  if (word.includes('今天')) end.setHours(23, 59, 59, 0)
  else if (word.includes('明')) {
    end.setDate(end.getDate() + 1)
    end.setHours(23, 59, 59, 0)
  } else if (word.includes('后天')) {
    end.setDate(end.getDate() + 2)
    end.setHours(23, 59, 59, 0)
  } else if (word.includes('本周')) {
    const day = end.getDay() || 7
    end.setDate(end.getDate() + (5 - day))
    end.setHours(23, 59, 59, 0)
  } else if (word.includes('下周')) {
    const day = end.getDay() || 7
    end.setDate(end.getDate() + (12 - day))
    end.setHours(23, 59, 59, 0)
  } else return undefined
  return end.toISOString()
}

const ADD_PREFIX_STRIPS = [
  '请', '帮我', '麻烦', '能否', '可以', '把', '记住', '记下来', '记一下', '帮我记', '帮我记下', '别忘了', '记得', '记得要',
  '加入任务栈', '加到任务栈', '记入任务栈', '添加待办', '新建待办', '创建待办', '待办项', '待办',
] as const

function cleanTitle(raw: string): string {
  let t = String(raw || '').trim()
  t = t.replace(/^[\s"'「『《【\[]+/, '').replace(/[\s"'」』》】\]]+$/, '')
  for (const p of ADD_PREFIX_STRIPS) {
    if (t.startsWith(p)) {
      t = t.slice(p.length).replace(/^[:：\s]+/, '').trim()
    }
  }
  t = t.replace(/\s+/g, ' ').trim()
  t = t.replace(/[。！!？?；;，,]+$/, '').trim()
  return t.slice(0, 240)
}

const INVALID_TITLES = new Set(['好', '好的', '是', '否', '嗯', 'ok', 'yes', 'no', '查询', '查看', '分析', '总结', '报告', '说明'])

function isValidTitle(title: string) {
  const t = title.trim()
  if (t.length < 4 || t.length > 240) return false
  if (INVALID_TITLES.has(t.toLowerCase())) return false
  return true
}

function parsePriority(text: string): TaskPriority {
  return parsePriorityStructural(text)
}

function quotedTitle(text: string): string | null {
  const pairs: Array<[string, string]> = [
    ['「', '」'],
    ['『', '』'],
    ['《', '》'],
    ['【', '】'],
    ['"', '"'],
    ["'", "'"],
  ]
  for (const [open, close] of pairs) {
    const start = text.indexOf(open)
    if (start < 0) continue
    const end = text.indexOf(close, start + open.length)
    if (end > start) {
      const inner = text.slice(start + open.length, end).trim()
      if (inner.length >= 4) return inner
    }
  }
  for (const lead of ['叫做', '名为', '内容是']) {
    const i = text.indexOf(lead)
    if (i >= 0) {
      const tail = text.slice(i + lead.length).replace(/^[:：\s]+/, '').trim()
      if (tail.length >= 4) return tail.slice(0, 200)
    }
  }
  return null
}

/** LLM 开启时的规则 fallback：仅识别显式格式（待办: / TODO:） */
function parseUserTaskStackIntentStructuralOnly(userText: string): TaskStackIngestResult {
  const text = String(userText || '').replace(/\r\n/g, '\n').trim()
  if (!text || text.length < 4) return { kind: 'none' }
  if (looksLikeTaskStackQuery(text)) return { kind: 'none' }

  const todoTitle = parseTodoLineTitle(text)
  if (todoTitle) {
    const title = cleanTitle(todoTitle)
    if (isValidTitle(title)) {
      return {
        kind: 'add',
        title,
        priority: parsePriority(text),
        deadline: parseDeadline(text)
      }
    }
  }
  return { kind: 'none' }
}

const DONE_PATTERNS: RegExp[] = [
  /(?:待办|任务)(?:已)?完成[:：\s]+(.+)/i,
  /(?:标记|标为).{0,4}(?:完成|done)[:：\s]+(.+)/i,
  /(?:完成|做完|搞定)(?:这个)?待办[:：\s]+(.+)/i,
  /^(?:完成|做完|搞定)[:：\s]+(.+)$/i
]

const DELETE_PATTERNS: RegExp[] = [
  /(?:删除|移除|取消)(?:这个)?(?:待办|任务)[:：\s]+(.+)/i,
  /从任务栈(?:中)?(?:删除|移除)[:：\s]+(.+)/i
]

const ADD_INLINE =
  /(?:加入|加到|放入|记入).{0,8}任务栈[:：\s]*(.+)/i

const REMEMBER_TAIL =
  /(?:记住|记下来|记一下|帮我记(?:住|下)?|别忘了|记得要)[:：\s]+(.{4,200})/i

const FOLLOW_UP =
  /(?:后续|下一步)(?:要|需要|得)?[:：\s]+(.{6,200})/i

function firstCapture(patterns: RegExp[], text: string): string | null {
  for (const re of patterns) {
    const m = text.match(re)
    const cap = m?.[1]?.trim()
    if (cap) return cap
  }
  return null
}

/** 完整规则层（LLM 关闭时） */
function parseUserTaskStackIntentByRules(userText: string): TaskStackIngestResult {
  const text = String(userText || '').replace(/\r\n/g, '\n').trim()
  if (!text || text.length < 4) return { kind: 'none' }

  if (looksLikeTaskStackQuery(text)) return { kind: 'none' }

  const doneCap = firstCapture(DONE_PATTERNS, text)
  if (doneCap) {
    const title = cleanTitle(doneCap)
    if (isValidTitle(title)) return { kind: 'done', title }
  }

  const delCap = firstCapture(DELETE_PATTERNS, text)
  if (delCap) {
    const title = cleanTitle(delCap)
    if (isValidTitle(title)) return { kind: 'delete', title }
  }

  const explicitStack = text.match(ADD_INLINE)
  if (explicitStack?.[1]) {
    const title = cleanTitle(explicitStack[1])
    if (isValidTitle(title)) {
      return {
        kind: 'add',
        title,
        priority: parsePriority(text),
        deadline: parseDeadline(text)
      }
    }
  }

  const todoTitle = parseTodoLineTitle(text)
  if (todoTitle) {
    const title = cleanTitle(todoTitle)
    if (isValidTitle(title)) {
      return {
        kind: 'add',
        title,
        priority: parsePriority(text),
        deadline: parseDeadline(text)
      }
    }
  }

  const remember = text.match(REMEMBER_TAIL)
  if (remember?.[1] && !['查询', '分析', '总结', '报告'].some((m) => remember[1].includes(m))) {
    const title = cleanTitle(remember[1])
    if (isValidTitle(title)) {
      return {
        kind: 'add',
        title,
        priority: parsePriority(text),
        deadline: parseDeadline(text)
      }
    }
  }

  const follow = text.match(FOLLOW_UP)
  if (follow?.[1] && ['待办', '任务栈', '记住', '记下来'].some((m) => text.includes(m))) {
    const title = cleanTitle(follow[1])
    if (isValidTitle(title)) {
      return {
        kind: 'add',
        title,
        priority: parsePriority(text),
        deadline: parseDeadline(text)
      }
    }
  }

  if (
    ['加入', '加到', '放入', '记入'].some((m) => text.includes(`${m}`) && text.includes('任务栈')) ||
    ['记住', '记下来', '记一下', '帮我记', '别忘了', '记得要', '添加待办', '新建待办'].some((m) => text.includes(m))
  ) {
    const fromQuote = quotedTitle(text)
    const title = cleanTitle(fromQuote || text)
    if (isValidTitle(title) && title !== text.slice(0, 240)) {
      return {
        kind: 'add',
        title,
        priority: parsePriority(text),
        deadline: parseDeadline(text)
      }
    }
    const afterColon = text.split(/[:：]/).pop()?.trim()
    if (afterColon && afterColon !== text) {
      const t2 = cleanTitle(afterColon)
      if (isValidTitle(t2)) {
        return {
          kind: 'add',
          title: t2,
          priority: parsePriority(text),
          deadline: parseDeadline(text)
        }
      }
    }
  }

  return { kind: 'none' }
}

/** 是否像任务栈增删改（非普通问答）；无此类信号时不应阻塞路由去调 LLM */
export function looksLikePotentialTaskStackOp(userText: string): boolean {
  const text = String(userText || '').trim()
  if (!text || text.length < 4) return false
  if (looksLikeTaskStackQuery(text)) return false
  const markers = [
    '待办',
    '任务栈',
    'TODO',
    'todo',
    '记住',
    '记下来',
    '记一下',
    '帮我记',
    '别忘了',
    '记得要',
    '加入任务栈',
    '加到任务栈',
    '记入任务栈',
    '添加待办',
    '新建待办',
    '创建待办',
    '完成待办',
    '删除待办',
    '移除待办',
    '取消待办',
    '标记完成',
    '标为完成',
    '做完待办',
    '搞定待办'
  ]
  return markers.some((m) => text.includes(m))
}

/** 从用户单轮输入解析任务栈操作（规则层，供 WS 在路由前调用） */
export function parseUserTaskStackIntent(userText: string): TaskStackIngestResult {
  return parseUserTaskStackIntentByRules(userText)
}

function findTaskByTitleHint(items: TaskStackItem[], hint: string): TaskStackItem | null {
  const h = hint.trim().toLowerCase()
  if (!h) return null
  const active = items.filter((t) => t.status !== 'done')
  const exact = active.find((t) => t.title.toLowerCase() === h)
  if (exact) return exact
  const contains = active.find((t) => t.title.toLowerCase().includes(h) || h.includes(t.title.toLowerCase()))
  return contains || null
}

export type IngestApplyOutcome = {
  applied: boolean
  action?: 'add' | 'done' | 'delete'
  title?: string
  stack: TaskStack
}

/** 解析并写入任务栈；LLM 优先，仅保留显式格式（待办:/TODO:）结构兜底 */
export async function applyUserTaskStackIngest(
  policyDir: string,
  sessionId: string,
  userText: string,
  llm?: { openaiApiKey?: string; openaiModel?: string; openaiBaseUrl?: string }
): Promise<IngestApplyOutcome> {
  const stack0 = await loadTaskStack(policyDir, sessionId)
  if (!isTaskStackAutoIngestEnabled()) {
    return { applied: false, stack: stack0 }
  }

  let intent: TaskStackIngestResult = { kind: 'none' }

  const { isTaskStackIngestLlmEnabled, parseUserTaskStackIntentByLlm } = await import(
    '../../llm/taskStackIngestLlm'
  )
  if (isTaskStackIngestLlmEnabled()) {
    const llmIntent = await parseUserTaskStackIntentByLlm(userText, llm)
    if (llmIntent) intent = llmIntent
  } else {
    intent = parseUserTaskStackIntentByRules(userText)
  }

  if (intent.kind === 'none') {
    intent = parseUserTaskStackIntentStructuralOnly(userText)
  }
  if (intent.kind === 'none') {
    return { applied: false, stack: stack0 }
  }

  if (intent.kind === 'add') {
    const stack = await upsertTaskStackItem(policyDir, sessionId, {
      title: intent.title,
      note: '用户对话自动入栈',
      status: 'active',
      priority: intent.priority,
      deadline: intent.deadline,
      source: 'user'
    })
    return { applied: true, action: 'add', title: intent.title, stack }
  }

  const match = findTaskByTitleHint(stack0.items, intent.title)
  if (!match) {
    return { applied: false, stack: stack0 }
  }

  if (intent.kind === 'done') {
    const stack = await setTaskStackStatus(policyDir, sessionId, match.id, 'done')
    return { applied: true, action: 'done', title: match.title, stack }
  }

  const stack = await deleteTaskStackItem(policyDir, sessionId, match.id)
  return { applied: true, action: 'delete', title: match.title, stack }
}

/** Router JSON 中的 taskStackOp / taskStackTitle（LLM 结构化，补规则未命中） */
export async function applyRouterTaskStackOp(
  policyDir: string,
  sessionId: string,
  op?: 'none' | 'add' | 'done' | 'delete',
  title?: string
): Promise<IngestApplyOutcome | null> {
  if (!isTaskStackRouterExtractEnabled() || !op || op === 'none') return null
  const t = cleanTitle(String(title || ''))
  if (!isValidTitle(t)) return null
  if (op === 'add') {
    return applyUserTaskStackIngest(policyDir, sessionId, `待办：${t}`)
  }
  if (op === 'done') {
    return applyUserTaskStackIngest(policyDir, sessionId, `完成待办：${t}`)
  }
  return applyUserTaskStackIngest(policyDir, sessionId, `删除待办：${t}`)
}
