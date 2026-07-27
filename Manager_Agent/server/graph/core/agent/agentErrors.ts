export type ManagerAgentError = {
  code: string
  phase: 'probe' | 'plan' | 'execute' | 'synth' | 'unknown'
  agent: string
  message: string
  retryable: boolean
  runId?: string
}

export function buildAgentError(
  input: {
    agent: string
    message: string
    code?: string
    phase?: ManagerAgentError['phase']
    retryable?: boolean
    runId?: string
  }
): ManagerAgentError {
  const msg = String(input.message || '').trim() || 'unknown error'
  const lower = msg.toLowerCase()
  const retryable =
    input.retryable ??
    (/timeout|timed out|econnrefused|socket hang up|503|502|504|unavailable|abort/i.test(lower) &&
      !/permission|forbidden|invalid|syntax|not found/i.test(lower))
  return {
    code: input.code || 'agent_failed',
    phase: input.phase || 'execute',
    agent: String(input.agent || 'unknown'),
    message: msg,
    retryable,
    runId: input.runId
  }
}

export function emitAgentError(
  sendEvent: (ev: { event: string; data?: unknown; from?: string }) => void,
  err: ManagerAgentError
): void {
  sendEvent({ event: 'agent_error', data: err, from: err.agent })
}

export function emitAgentEvidence(
  sendEvent: (ev: { event: string; data?: unknown; from?: string }) => void,
  agent: string,
  evidence: Record<string, unknown> | null | undefined
): void {
  if (!evidence || typeof evidence !== 'object') return
  const citations = Array.isArray(evidence.citations) ? evidence.citations : []
  const hits = Number(evidence.hits ?? citations.length) || 0
  if (agent === 'rag' && hits === 0 && citations.length === 0) return
  sendEvent({
    event: 'agent_evidence',
    data: {
      agent,
      kind: String(evidence.kind || agent),
      hits,
      query: evidence.query,
      citations: citations.slice(0, 12)
    },
    from: agent
  })
}

export function createAgentFailureNotifier(
  sendEvent: (ev: { event: string; data?: unknown; from?: string }) => void,
  runId?: string
) {
  return (agent: string, message: string, phase: ManagerAgentError['phase'] = 'execute') => {
    emitAgentError(sendEvent, buildAgentError({ agent, message, phase, runId }))
  }
}
