import path from 'node:path'
import fs from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { readManagerSession, writeManagerSession } from '../../utils/session/managerSessionStore'
import { buildTaskScopedRagHistory } from '../../graph/core/routing/clauses'
import { loadTaskStack, saveTaskStack } from '../../graph/core/task/taskStack'
import { applyUserTaskStackIngest } from '../../graph/core/task/taskStackIngest'
import { bindSessionToUser, resolveUserId } from '../../graph/core/task/userIdentity'
import { linkSessionToUserGoals } from '../../graph/core/task/userGoals'
import { recordImplicitLearningSignal } from '../../graph/core/evolution/implicitLearning'
import { extractAdminPendingOps } from '../../graph/core/stepIsolation'
import { buildRunObservabilityPayload } from '../../graph/core/runtime/runObservability'
import { buildActionCardsFromHumanConfirm } from '../../graph/core/output/actionCard'
import { effectiveAgentTimeoutMs } from '../../graph/core/shared/llmJson'
import { resolveAgentEndpointsWithPlatform } from '../../utils/platform/agentPlatformSync'
import { RunIdSchema } from './schemas'
import { runMeta, type WsSession } from './runtimeState'

export type { WsSession }
export type Session = WsSession

export function policyDataDir() {
  return path.join(process.cwd(), '.data')
}

export function graphAgentEndpoints(
  agents: Record<string, unknown>,
  resolved: Awaited<ReturnType<typeof resolveAgentEndpointsWithPlatform>>
) {
  return {
    dbAgentWsUrl: resolved.dbAgentWsUrl || String(agents.dbAgentWsUrl || ''),
    dbAgentHttpUrl: resolved.dbAgentHttpUrl || String(agents.dbAgentHttpUrl || ''),
    ragAgentHttpUrl: resolved.ragAgentHttpUrl || String(agents.ragAgentHttpUrl || ''),
    codeAgentWsUrl: resolved.codeAgentWsUrl || String(agents.codeAgentWsUrl || ''),
    crawlerAgentWsUrl: resolved.crawlerAgentWsUrl || String(agents.crawlerAgentWsUrl || ''),
    lobsterAgentWsUrl: resolved.lobsterAgentWsUrl || String(agents.lobsterAgentWsUrl || ''),
    aiAdminAgentWsUrl: resolved.aiAdminAgentWsUrl || String(agents.aiAdminAgentWsUrl || ''),
    multimodalAgentHttpUrl: resolved.multimodalAgentHttpUrl || String(agents.multimodalAgentHttpUrl || ''),
    musicAgentWsUrl: resolved.musicAgentWsUrl || String(agents.musicAgentWsUrl || ''),
    videoAgentWsUrl: resolved.videoAgentWsUrl || String(agents.videoAgentWsUrl || ''),
    timeoutMs: effectiveAgentTimeoutMs(Number(agents.timeoutMs || process.env.AGENT_TIMEOUT_MS || 60_000)),
    platformOffline: resolved.platformOffline
  }
}

export async function emitImplicitLearning(
  runId: string,
  sessionId: string,
  kind: 'user_cancel' | 'new_chat_interrupt' | 'human_reject'
) {
  const meta = runMeta.get(runId)
  const durationMs = meta ? Date.now() - meta.startedAtMs : undefined
  try {
    await recordImplicitLearningSignal(policyDataDir(), {
      runId,
      sessionId: meta?.sessionId || sessionId,
      kind,
      durationMs
    })
  } catch {}
}

export async function ingestTaskStackFromUserMessage(
  sessionId: string,
  userText: string,
  send: (event: string, data: unknown, from?: string, runId?: string) => void,
  runId: string,
  llm?: { openaiApiKey?: string; openaiModel?: string; openaiBaseUrl?: string }
) {
  try {
    const r = await applyUserTaskStackIngest(policyDataDir(), sessionId, userText, llm)
    if (!r.applied) return
    send('task_stack', { stack: r.stack }, 'manager', runId)
    const verb =
      r.action === 'add' ? '已自动加入任务栈' : r.action === 'done' ? '已标记任务完成' : '已从任务栈移除'
    send('thinking', `${verb}：${r.title || ''}`, 'manager', runId)
  } catch {}
}

export async function ensureUserBinding(sessionId: string, userId?: string) {
  const dir = policyDataDir()
  const uid = await resolveUserId(dir, sessionId, userId)
  if (uid && userId) await bindSessionToUser(dir, sessionId, userId).catch(() => undefined)
  if (uid) await linkSessionToUserGoals(dir, uid, sessionId).catch(() => undefined)
  return uid
}

export async function clearExperience() {
  const dir = policyDataDir()
  const memJsonlPath = path.join(dir, 'manager-memory.jsonl')
  const memJsonPath = path.join(dir, 'manager-memory.json')
  const policyPath = path.join(dir, 'manager-policy.json')

  let removed = 0
  let kept = 0

  const readJson = async (p: string) => {
    try {
      const t = await fs.readFile(p, 'utf8')
      return t.trim() ? JSON.parse(t) : null
    } catch {
      return null
    }
  }

  const filterLines = (lines: string[]) => {
    const out: string[] = []
    for (const line of lines) {
      const s = String(line || '').trim()
      if (!s) continue
      try {
        const obj = JSON.parse(s)
        if (obj?.type === 'experience') {
          removed += 1
          continue
        }
        kept += 1
        out.push(JSON.stringify(obj))
      } catch {
        kept += 1
        out.push(s)
      }
    }
    return out
  }

  const jsonlText = await fs.readFile(memJsonlPath, 'utf8').catch(() => '')
  if (jsonlText.trim()) {
    const lines = jsonlText.split('\n')
    const next = filterLines(lines)
    await fs.writeFile(memJsonlPath, next.length ? `${next.join('\n')}\n` : '', 'utf8').catch(() => undefined)
  }

  const jsonObj = await readJson(memJsonPath)
  const history = Array.isArray(jsonObj?.history) ? jsonObj.history : null
  if (history) {
    const nextHistory: unknown[] = []
    for (const h of history) {
      if ((h as { type?: string })?.type === 'experience') {
        removed += 1
        continue
      }
      nextHistory.push(h)
    }
    await fs.writeFile(memJsonPath, JSON.stringify({ ...jsonObj, history: nextHistory }, null, 2), 'utf8').catch(() => undefined)
  }

  await fs.unlink(policyPath).catch(() => undefined)
  return { removed, kept }
}

export async function readSession(sessionId: string) {
  return readManagerSession(sessionId)
}

export async function writeSession(sessionId: string, session: WsSession) {
  await writeManagerSession(sessionId, session)
}

export async function appendRunEvent(runId: string, event: { event: string; data?: unknown; from?: string; ts: string }) {
  const rid = String(runId || '').trim()
  if (!rid) return
  try {
    if (!RunIdSchema.safeParse(rid).success) return
    const dir = path.join(process.cwd(), '.data', 'runs')
    await fs.mkdir(dir, { recursive: true }).catch(() => undefined)
    const p = path.join(dir, `${rid}.jsonl`)
    const safeEvent = {
      event: String(event?.event || '').slice(0, 40),
      from: typeof event?.from === 'string' ? event.from.slice(0, 24) : undefined,
      ts: typeof event?.ts === 'string' ? event.ts : new Date().toISOString(),
      data: (() => {
        const d = event?.data
        if (typeof d === 'string') return d.length > 2000 ? `${d.slice(0, 2000)}…` : d
        if (typeof d === 'number' || typeof d === 'boolean' || d === null || d === undefined) return d
        try {
          const json = JSON.stringify(d)
          if (json.length <= 2000) return d
          return { clipped: json.slice(0, 2000) }
        } catch {
          return { clipped: String(d).slice(0, 2000) }
        }
      })()
    }
    await fs.appendFile(p, `${JSON.stringify(safeEvent)}\n`, 'utf8')
    const meta = runMeta.get(rid)
    void import('#agent-shared/runTraceStore')
      .then(({ appendRunTraceEvent }) =>
        appendRunTraceEvent({
          runId: rid,
          sessionId: meta?.sessionId,
          tenantId: meta?.tenantId,
          event: safeEvent.event,
          fromAgent: safeEvent.from,
          payload: safeEvent.data,
          ts: safeEvent.ts
        })
      )
      .catch(() => undefined)
  } catch {}
}

export function sanitizeHistoryText(input: string) {
  let s = String(input ?? '')
  s = s.replace(/Error:\s*Tool\s*`[^`]+`\s*not\s*found\.[^\n\r]*/gi, '')
  s = s.replace(/Tool\s*`[^`]+`\s*not\s*found\.[^\n\r]*/gi, '')
  s = s.replace(/\n{3,}/g, '\n\n')
  return s.trim()
}

export function stripAttachmentSuffix(content: string) {
  return String(content || '')
    .replace(/\n\[附件:[^\]]+\]\s*$/i, '')
    .replace(/^\[附件:[^\]]+\]\s*$/i, '')
    .trim()
}

export function buildUserContent(text: string, mediaAttachment?: { filename?: string; mediaType?: string } | null) {
  const trimmed = String(text ?? '').trim()
  if (trimmed && mediaAttachment?.filename) return `${trimmed}\n[附件: ${mediaAttachment.filename}]`
  if (trimmed && mediaAttachment) return `${trimmed}\n[附件: ${mediaAttachment.mediaType}]`
  if (trimmed) return trimmed
  if (mediaAttachment?.filename) return `[附件: ${mediaAttachment.filename}]`
  return `[附件: ${mediaAttachment?.mediaType || 'file'}]`
}

export function resolveUserMessageSessionIndex(messages: WsSession['messages'], userMessageIndex: number): number {
  if (!Array.isArray(messages) || userMessageIndex < 0) return -1
  let nth = 0
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]?.role === 'user') {
      if (nth === userMessageIndex) return i
      nth++
    }
  }
  return -1
}

export async function pruneAutoUserTasksOnEditResend(policyDir: string, sessionId: string) {
  try {
    const stack = await loadTaskStack(policyDir, sessionId)
    const kept = stack.items.filter(
      (item) => !(item.source === 'user' && item.note === '用户对话自动入栈' && item.status === 'active')
    )
    if (kept.length === stack.items.length) return stack
    return await saveTaskStack(policyDir, { ...stack, items: kept })
  } catch {
    return null
  }
}

export function buildRagHistoryForRun(session: WsSession, currentUserText: string) {
  const all = session.messages
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: sanitizeHistoryText(m.content) }))
    .filter((m) => String(m.content || '').trim())
  const scoped = buildTaskScopedRagHistory(all, currentUserText)
  if (scoped.length) return scoped
  const last = all.filter((m) => m.role === 'user').slice(-1)
  return last
}

export function isHumanConfirmClarification(meta: Record<string, unknown> | null | undefined, finalText: string) {
  // 写操作已成功落库：禁止再暂停确认（成功文案含 add_event 时不可误触发续跑死循环）
  if (adminWriteAlreadyCompleted(meta, finalText)) return false

  if (Boolean(meta?.needsHumanConfirm)) return true
  const agentResult = meta?.agentResult
  if (agentResult && typeof agentResult === 'object') {
    const structured = (agentResult as { structured?: Record<string, unknown> }).structured
    if (structured?.needs_human_confirm === true) return true
    const pending = structured?.pending_actions
    if (Array.isArray(pending) && pending.length > 0) return true
  }
  const qs = Array.isArray(meta?.clarifyQuestions) ? meta.clarifyQuestions : []
  const hasAdminKeyword = qs.some((q) =>
    /(需要人工确认|待确认的个人事务操作|请回复[“"']?确认[”"']?\s*继续|回复[“"']?确认[”"']?.*继续|取消中止|或回复[“"']?取消[”"']?\s*中止)/i.test(
      String(q || '')
    )
  )
  if (hasAdminKeyword) return true
  // 仅认 tool[id] 形态；裸 add_* 已从 extractAdminPendingOps 移除
  if (extractAdminPendingOps(finalText).length > 0 && !Boolean(meta?.allowRiskyWrites)) return true
  const s = String(finalText || '')
  if (/【待确认】/.test(s) && !Boolean(meta?.allowRiskyWrites)) return true
  return /(需要人工确认|待确认的个人事务操作|请回复[“"']?确认[”"']?\s*继续|回复[“"']?取消[”"']?\s*中止)/i.test(s)
}

/** admin 步骤已成功写入（日程/提醒等），不应再进入写确认闸门 */
export function adminWriteAlreadyCompleted(
  meta: Record<string, unknown> | null | undefined,
  finalText: string
): boolean {
  const records = Array.isArray(meta?.lastStepRecords)
    ? (meta!.lastStepRecords as Array<Record<string, unknown>>)
    : []
  const adminRecs = records.filter((r) => String(r?.agent || '').toLowerCase() === 'admin')
  if (adminRecs.length) {
    const anyPendingClarify = adminRecs.some(
      (r) =>
        r?.needsClarify === true ||
        String(r?.error || '').toLowerCase() === 'needs_clarify' ||
        /needs_clarify|needs_human_confirm/i.test(String(r?.error || ''))
    )
    if (anyPendingClarify) return false
    const allOk = adminRecs.every((r) => {
      const st = String(r?.status || '').toLowerCase()
      return st === 'ok' || st === 'success' || st === 'skipped'
    })
    if (allOk) return true
  }
  const blob = [
    String(finalText || ''),
    String((meta as { results?: { admin?: string } } | undefined)?.results?.admin || '')
  ].join('\n')
  if (/【待确认】/.test(blob)) return false
  if (/已添加日程|已设置提醒|已添加待办|reminder_created|event_id\s*[:=]/i.test(blob)) return true
  const verdict = meta?.verifierVerdict as { outcome?: string; verdict?: string } | undefined
  if (verdict?.outcome === 'completed' && verdict?.verdict === 'pass' && adminRecs.length) return true
  return false
}

export function emitAdminHumanConfirmRequest(
  send: (event: string, data?: unknown, from?: string, runId?: string) => void,
  runId: string,
  message: string,
  opts?: {
    confirmId?: string
    title?: string
    checkpointResume?: boolean
    agent?: string
    screenshotDataUrl?: string
    pageUrl?: string
    failureType?: string
    adminPendingOps?: unknown[]
  }
) {
  const confirmId = String(opts?.confirmId || randomUUID()).trim()
  const agent = String(opts?.agent || 'admin').trim() || 'admin'
  const payload = {
    title: String(opts?.title || (agent === 'gui' ? '浏览器操作待确认' : '个人事务写操作待确认')).trim(),
    message: String(message || '').trim() || '请确认是否继续执行写操作。',
    agent,
    confirmId,
    checkpointResume: opts?.checkpointResume !== false,
    ...(opts?.screenshotDataUrl ? { screenshotDataUrl: opts.screenshotDataUrl } : {}),
    ...(opts?.pageUrl ? { pageUrl: opts.pageUrl } : {}),
    ...(opts?.failureType ? { failureType: opts.failureType } : {})
  }
  send('human_confirm_request', payload, 'manager', runId)
  const actions = buildActionCardsFromHumanConfirm({
    agent,
    title: payload.title,
    message: payload.message,
    confirmId,
    screenshotDataUrl: opts?.screenshotDataUrl,
    pageUrl: opts?.pageUrl,
    failureType: opts?.failureType,
    adminPendingOps: opts?.adminPendingOps
  })
  send(
    'user_facing',
    {
      summary: payload.message,
      outcome: 'needs_human',
      outcomeLabel: '待你确认',
      actions
    },
    'manager',
    runId
  )
  return confirmId
}

export function pauseAdminConfirmMessage(result: { meta?: Record<string, unknown>; results?: Record<string, string> }) {
  const meta = result?.meta ?? {}
  const ops = Array.isArray(meta.adminPendingOps)
    ? meta.adminPendingOps.map((x) => String(x ?? '').trim()).filter(Boolean)
    : extractAdminPendingOps(String(result?.results?.admin || ''))
  return ops.length ? `待执行：${ops.join('、')}` : '个人事务写操作'
}

export async function emitRunObservability(
  send: (event: string, data?: unknown, from?: string, runId?: string) => void,
  runId: string
) {
  try {
    const payload = await buildRunObservabilityPayload(runId)
    if (!payload.phaseTimeline.length && !payload.tokenSummary.totalTokens) return
    send('phase_timeline', payload, 'manager', runId)
    send(
      'run_metrics',
      {
        runId: payload.runId,
        wallClockMs: payload.wallClockMs,
        tokenSummary: payload.tokenSummary
      },
      'manager',
      runId
    )
  } catch {}
}
