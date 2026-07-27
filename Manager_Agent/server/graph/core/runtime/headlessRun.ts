import { AIMessage, HumanMessage } from '@langchain/core/messages'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { readManagerSession, writeManagerSession } from '../../../utils/session/managerSessionStore'
import { createManagerGraph } from '../../state/graphEntry'
import { buildManagerGraphInvokeConfig } from '../../state/invokeConfig'
import { resolveAgentEndpoints } from '../../../utils/platform/agentEndpoints'
import { composeFinalFromGraphResult } from '../output/composeFinal'
import { isSynthRejectingMedia } from '../shared'
import type { AutonomousJob } from '../task/autonomousQueue'
import { publishAutonomousResult } from '../task/autonomousNotify'
import { isAdminWriteGateEnabled } from '../db/writeGate'
import { handleAutonomousRunComplete } from '../task/autonomousPlan'

type Session = { messages: { role: 'user' | 'assistant'; content: string }[] }

export type HeadlessRunResult = {
  ok: boolean
  error?: string
  finalText?: string
  jobId: string
  sessionId: string
  title: string
  kind: AutonomousJob['kind']
}

async function readSession(sessionId: string): Promise<Session> {
  return readManagerSession(sessionId)
}

async function writeSession(sessionId: string, session: Session) {
  await writeManagerSession(sessionId, session)
}

/** 后台自治队列：无 WS 客户端时执行轻量 graph run */
export async function executeHeadlessManagerRun(job: AutonomousJob): Promise<HeadlessRunResult> {
  const policyDir = path.join(process.cwd(), '.data')
  const base = {
    jobId: job.id,
    sessionId: job.sessionId,
    title: job.title,
    kind: job.kind
  }

  const openaiApiKey = String(process.env.OPENAI_API_KEY || '').trim()
  const openaiBaseUrl = String(process.env.OPENAI_BASE_URL || '').trim()
  const openaiModel = String(process.env.OPENAI_MODEL || '').trim()
  if (!openaiApiKey || !openaiBaseUrl || !openaiModel) {
    return { ...base, ok: false, error: 'missing OPENAI_* env' }
  }

  const sessionId = job.sessionId
  const session = await readSession(sessionId)
  const userLine = `[自治推进 ${new Date().toLocaleString('zh-CN', { hour12: false })}]\n${job.prompt}`
  session.messages.push({ role: 'user', content: userLine })

  const runId = crypto.randomUUID()
  const logDir = path.join(process.cwd(), '.data', 'autonomous-runs')
  await fs.mkdir(logDir, { recursive: true }).catch(() => undefined)
  const logPath = path.join(logDir, `${job.id}.jsonl`)

  const agents = resolveAgentEndpoints(process.env)
  const { effectiveAgentTimeoutMs } = await import('../shared/llmJson')
  const timeoutMs = effectiveAgentTimeoutMs(Number(process.env.AGENT_TIMEOUT_MS || 120_000))

  try {
    const graph = createManagerGraph({
      openaiApiKey,
      openaiBaseUrl,
      openaiModel,
      ...agents,
      timeoutMs,
      sendEvent: ({ event, data }) => {
        void fs
          .appendFile(logPath, `${JSON.stringify({ ts: new Date().toISOString(), event, data: String(data ?? '').slice(0, 500) })}\n`, 'utf8')
          .catch(() => undefined)
      },
      threadId: `auto-${job.id}`,
      runId,
      sessionId,
      userId: job.userId,
      ragConversationId: sessionId
    })

    const recent = session.messages.slice(-10)
    const history = recent.map((m) =>
      m.role === 'assistant' ? new AIMessage(m.content) : new HumanMessage(m.content)
    )

    const result = await graph.invoke(
      {
        messages: history,
        forceIntent: 'auto',
        mediaAttachment: null,
        meta: {
          autonomousRun: true,
          blockAdminWrites: isAdminWriteGateEnabled(),
          allowRiskyWrites: false
        }
      },
      buildManagerGraphInvokeConfig({ sessionId, runId: job.id })
    )

    const composed = composeFinalFromGraphResult(result)
    const mmOut = String((result as { results?: { multimodal?: string } })?.results?.multimodal ?? '').trim()
    let finalText = composed
    if (mmOut && isSynthRejectingMedia(finalText, mmOut)) finalText = mmOut
    if (!finalText) finalText = '（自治推进已完成，但未生成可展示正文，详见运行日志。）'

    const assistantBody = `【自治推进·${job.title}】\n${finalText}`.slice(0, 12_000)
    session.messages.push({ role: 'assistant', content: assistantBody })
    await writeSession(sessionId, session)
    await fs.appendFile(logPath, `${JSON.stringify({ ts: new Date().toISOString(), event: 'done', ok: true })}\n`, 'utf8').catch(() => undefined)

    await publishAutonomousResult(policyDir, {
      jobId: job.id,
      sessionId,
      title: job.title,
      kind: job.kind,
      ok: true,
      finalText: assistantBody,
      ts: new Date().toISOString()
    }).catch(() => undefined)

    const planFollow = await handleAutonomousRunComplete(policyDir, job, {
      ok: true,
      finalText: assistantBody
    }).catch(() => ({}) as { planCompleted?: boolean; nextStepEnqueued?: boolean })

    if (planFollow.nextStepEnqueued) {
      await fs
        .appendFile(
          logPath,
          `${JSON.stringify({ ts: new Date().toISOString(), event: 'replan_next_step' })}\n`,
          'utf8'
        )
        .catch(() => undefined)
    }
    if (planFollow.planCompleted) {
      await fs
        .appendFile(
          logPath,
          `${JSON.stringify({ ts: new Date().toISOString(), event: 'plan_completed' })}\n`,
          'utf8'
        )
        .catch(() => undefined)
    }

    return { ...base, ok: true, finalText: assistantBody }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    await fs.appendFile(logPath, `${JSON.stringify({ ts: new Date().toISOString(), event: 'error', error: msg })}\n`, 'utf8').catch(() => undefined)
    await publishAutonomousResult(policyDir, {
      jobId: job.id,
      sessionId,
      title: job.title,
      kind: job.kind,
      ok: false,
      error: msg,
      ts: new Date().toISOString()
    }).catch(() => undefined)
    await handleAutonomousRunComplete(policyDir, job, { ok: false, error: msg }).catch(() => undefined)
    return { ...base, ok: false, error: msg }
  }
}
