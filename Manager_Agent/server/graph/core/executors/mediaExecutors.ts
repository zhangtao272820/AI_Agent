import { unwrapAgentCall } from '../../../utils/agents/agentResult'
import type { AgentCallResult } from '../../../utils/agents/agentResult'
import { buildMediaWebContext } from '../../../utils/search/managerWebSearch'
import type { ManagerGraphState } from '../../state/state'
import type { AgentExecutorDeps, AgentExecutorOpts, AgentStepOutcome } from './types'

export async function executeMultimodalStep(
  deps: AgentExecutorDeps,
  opts: AgentExecutorOpts,
  input: {
    state: ManagerGraphState
    effQuery: string
    timeoutMs: number
  }
): Promise<AgentStepOutcome> {
  try {
    const att = input.state.mediaAttachment
    const res = await deps.callMultimodalAgent({
      multimodalAgentHttpUrl: opts.multimodalAgentHttpUrl,
      timeoutMs: input.timeoutMs,
      query: input.effQuery,
      action: 'understand',
      filePath: att?.filePath,
      mediaType: att?.mediaType || 'image',
      traceId: opts.runId,
      signal: opts.signal
    })
    const { answer, agentResult } = unwrapAgentCall(res as string | AgentCallResult)
    return {
      ok: true,
      agent: 'multimodal',
      output: answer,
      query: input.effQuery,
      meta: agentResult ? { agentResult } : undefined,
      evidence: { kind: 'multimodal', query: input.effQuery, agentResult }
    }
  } catch (e: unknown) {
    const err = String((e as Error)?.message || e || 'unknown error')
    return { ok: false, agent: 'multimodal', output: '', query: input.effQuery, error: err }
  }
}

export async function executeMusicStep(
  deps: AgentExecutorDeps,
  opts: AgentExecutorOpts,
  input: {
    effQuery: string
    timeoutMs: number
    sendThinking: (t: string) => void
    meta?: Record<string, unknown> | null
  }
): Promise<AgentStepOutcome> {
  try {
    const webContext = buildMediaWebContext(input.meta)
    if (webContext) {
      input.sendThinking('音乐 Agent：已注入联网参考摘要')
    }
    const res = await deps.callMusicAgent({
      musicAgentWsUrl: opts.musicAgentWsUrl,
      timeoutMs: input.timeoutMs,
      prompt: input.effQuery,
      webContext: webContext ?? undefined,
      traceId: opts.runId,
      sendThinking: input.sendThinking,
      sendProgress: ({ stage, pct }) => {
        opts.sendEvent({
          event: 'step_status',
          data: { stepId: 'music', agent: 'music', status: 'running', pct, stage },
          from: 'music'
        })
      },
      signal: opts.signal
    })
    const { answer, agentResult } = unwrapAgentCall(res as string | AgentCallResult)
    return {
      ok: true,
      agent: 'music',
      output: answer,
      query: input.effQuery,
      meta: agentResult ? { agentResult } : undefined,
      evidence: { kind: 'music', query: input.effQuery, agentResult }
    }
  } catch (e: unknown) {
    const err = String((e as Error)?.message || e || 'unknown error')
    return { ok: false, agent: 'music', output: '', query: input.effQuery, error: err }
  }
}

export async function executeVideoStep(
  deps: AgentExecutorDeps,
  opts: AgentExecutorOpts,
  input: {
    effQuery: string
    timeoutMs: number
    sendThinking: (t: string) => void
    meta?: Record<string, unknown> | null
  }
): Promise<AgentStepOutcome> {
  try {
    const webContext = buildMediaWebContext(input.meta)
    if (webContext) {
      input.sendThinking('视频 Agent：已注入联网场景参考')
    }
    const res = await deps.callVideoAgent({
      videoAgentWsUrl: opts.videoAgentWsUrl,
      timeoutMs: input.timeoutMs,
      prompt: input.effQuery,
      webContext: webContext ?? undefined,
      traceId: opts.runId,
      sendThinking: input.sendThinking,
      sendProgress: ({ stage, pct }) => {
        opts.sendEvent({
          event: 'step_status',
          data: { stepId: 'video', agent: 'video', status: 'running', pct, stage },
          from: 'video'
        })
      },
      signal: opts.signal
    })
    const { answer, agentResult } = unwrapAgentCall(res as string | AgentCallResult)
    return {
      ok: true,
      agent: 'video',
      output: answer,
      query: input.effQuery,
      meta: agentResult ? { agentResult } : undefined,
      evidence: { kind: 'video', query: input.effQuery, agentResult }
    }
  } catch (e: unknown) {
    const err = String((e as Error)?.message || e || 'unknown error')
    return { ok: false, agent: 'video', output: '', query: input.effQuery, error: err }
  }
}

