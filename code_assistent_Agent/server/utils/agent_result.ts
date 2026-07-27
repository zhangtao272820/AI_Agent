export type AgentSource = {
  type: 'url' | 'doc' | 'table' | 'sql'
  ref: string
}

export type AgentResult = {
  ok: boolean
  agent: string
  trace_id?: string
  answer?: string
  sources?: AgentSource[]
  structured?: Record<string, unknown>
  error_code?: string
  latency_ms?: number
}

export function buildCodeComputeAgentResult(params: {
  answer: string
  trace_id?: string
  ms?: number
  task_kind?: string
}): AgentResult {
  return {
    ok: Boolean(String(params.answer || '').trim()),
    agent: 'code',
    trace_id: params.trace_id,
    answer: params.answer,
    structured: {
      task_kind: params.task_kind || 'compute',
      ms: params.ms
    },
    latency_ms: params.ms
  }
}

export function buildCodeRetrieveAgentResult(params: {
  query: string
  hits: number
  snippets: Array<{ path: string; score?: number }>
  trace_id?: string
  ms?: number
}): AgentResult {
  const sources: AgentSource[] = params.snippets
    .map((s) => String(s.path || '').trim())
    .filter(Boolean)
    .slice(0, 12)
    .map((ref) => ({ type: 'doc' as const, ref }))
  return {
    ok: params.hits > 0,
    agent: 'code',
    trace_id: params.trace_id,
    answer: params.query,
    sources: sources.length ? sources : undefined,
    structured: { hits: params.hits, ms: params.ms },
    error_code: params.hits ? undefined : 'empty_result',
    latency_ms: params.ms
  }
}
