/** LangGraph invoke 配置（含 checkpointer thread_id） */

import {
  isManagerLangGraphCheckpointerEnabled,
  resolveLangGraphThreadId
} from '../core/runtime/langgraphCheckpointer'
import { readManagerRecursionLimit } from '../core/runtime/retryBudget'

export function buildManagerGraphInvokeConfig(extra?: Record<string, unknown>) {
  const { sessionId, runId, threadId, signal, freshThread, ...rest } = extra ?? {}
  const out: Record<string, unknown> = {
    recursionLimit: readManagerRecursionLimit(),
    ...rest
  }
  if (signal !== undefined) out.signal = signal

  if (isManagerLangGraphCheckpointerEnabled()) {
    const tid = resolveLangGraphThreadId({
      runId: String(runId ?? ''),
      sessionId: String(sessionId ?? ''),
      threadId: String(threadId ?? ''),
      freshThread: Boolean(freshThread)
    })
    if (tid) {
      out.configurable = {
        ...(typeof out.configurable === 'object' && out.configurable ? out.configurable : {}),
        thread_id: tid
      }
    }
  }
  return out
}

/** 新一轮用户提问：清空执行态，避免与 checkpoint reducer 合并时带入上一轮 results */
export function buildManagerTurnInvokeState(input: {
  messages: unknown[]
  forceIntent?: string
  mediaAttachment?: unknown
  meta?: Record<string, unknown>
}) {
  return {
    messages: input.messages,
    forceIntent: input.forceIntent ?? 'auto',
    mediaAttachment: input.mediaAttachment ?? null,
    results: {},
    evidence: [],
    plan: [],
    taskPlan: null,
    final: '',
    routedQuery: '',
    fixQuery: '',
    retryCount: 0,
    meta: input.meta ?? {}
  }
}
