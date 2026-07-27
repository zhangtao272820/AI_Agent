/**
 * 总管可选任务载荷（managerTask / manager_task_json），与 DB/RAG 对齐命名。
 */

export type CodeTaskKind = 'compute' | 'inspect' | 'edit' | 'script'

export type StructuredUpstreamFact = {
  key: string
  value: unknown
  source?: string
  agent?: string
}

export type ManagerCodeTaskPayload = {
  source?: string
  task_kind?: CodeTaskKind
  refined_question?: string
  upstream_context?: string
  facts?: StructuredUpstreamFact[]
  hint_files?: string[]
  hint_symbols?: string[]
  must_outputs?: string[]
  completion_criteria?: string[]
  risk_notes?: string[]
  write_allowed?: boolean
}

function asStringArray(value: unknown, max: number): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out = value.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, max)
  return out.length ? out : undefined
}

export function parseManagerCodeTask(raw?: string | Record<string, unknown> | null): ManagerCodeTaskPayload | null {
  let obj: Record<string, unknown> | null = null
  if (raw && typeof raw === 'object') obj = raw
  else if (typeof raw === 'string' && raw.trim()) {
    try {
      obj = JSON.parse(raw.trim()) as Record<string, unknown>
    } catch {
      return null
    }
  }
  if (!obj || typeof obj !== 'object') return null

  const kindRaw = String(obj.task_kind ?? obj.taskKind ?? '').trim().toLowerCase()
  const task_kind: CodeTaskKind | undefined =
    kindRaw === 'compute' || kindRaw === 'inspect' || kindRaw === 'edit' || kindRaw === 'script'
      ? kindRaw
      : undefined

  const refined = String(obj.refined_question ?? obj.refined_task ?? obj.query ?? '').trim()
  const upstream = String(obj.upstream_context ?? obj.upstreamContext ?? '').trim()
  const hint_files = asStringArray(obj.hint_files ?? obj.hintFiles, 12)
  const hint_symbols = asStringArray(obj.hint_symbols ?? obj.hintSymbols, 12)
  const must_outputs = asStringArray(obj.must_outputs ?? obj.mustOutputs, 6)
  const completion_criteria = asStringArray(obj.completion_criteria ?? obj.completionCriteria, 6)
  const risk_notes = asStringArray(obj.risk_notes ?? obj.riskNotes, 6)

  const write_allowed =
    typeof obj.write_allowed === 'boolean'
      ? obj.write_allowed
      : typeof obj.writeAllowed === 'boolean'
        ? obj.writeAllowed
        : undefined

  const facts = Array.isArray(obj.facts)
    ? obj.facts
        .map((f) => {
          const row = f && typeof f === 'object' ? (f as Record<string, unknown>) : {}
          const key = String(row.key ?? '').trim()
          if (!key) return null
          return {
            key,
            value: row.value,
            source: String(row.source ?? row.agent ?? '').trim() || undefined,
            agent: String(row.agent ?? row.source ?? '').trim() || undefined,
          } as StructuredUpstreamFact
        })
        .filter((x): x is StructuredUpstreamFact => Boolean(x))
        .slice(0, 40)
    : undefined

  if (!task_kind && !refined && !upstream && !hint_files?.length && !facts?.length) return null

  return {
    ...(task_kind ? { task_kind } : {}),
    ...(refined ? { refined_question: refined } : {}),
    ...(upstream ? { upstream_context: upstream } : {}),
    ...(facts?.length ? { facts } : {}),
    ...(hint_files?.length ? { hint_files } : {}),
    ...(hint_symbols?.length ? { hint_symbols } : {}),
    ...(must_outputs?.length ? { must_outputs } : {}),
    ...(completion_criteria?.length ? { completion_criteria } : {}),
    ...(risk_notes?.length ? { risk_notes } : {}),
    ...(write_allowed !== undefined ? { write_allowed } : {}),
  }
}
