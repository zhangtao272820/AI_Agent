/**
 * 跨 Agent 轮次范围 SSOT（总管 → DB/RAG/Admin 对齐）。
 * 原则：默认隔离；仅 continuation 携带有限历史。
 */

export const TURN_SCOPE_MODES = ['current_only', 'continuation', 'topic_shift', 'chitchat'] as const
export type TurnScopeMode = (typeof TURN_SCOPE_MODES)[number]

export const TURN_KINDS = ['new_task', 'continuation', 'output_followup', 'slot_answer', 'chitchat'] as const
export type TurnKind = (typeof TURN_KINDS)[number]

export type TurnScopePayload = {
  mode: TurnScopeMode
  /** 细粒度轮次语义（总管 turn_scope LLM） */
  turn_kind?: TurnKind
  suppress_history: boolean
  suppress_anchor: boolean
  suppress_experience_replay: boolean
  /** output_followup：子 Agent 仅携带上一轮 assistant 片段 */
  narrow_output_followup?: boolean
}

export function parseTurnKind(raw: unknown): TurnKind | null {
  const k = String(raw ?? '').trim()
  return (TURN_KINDS as readonly string[]).includes(k) ? (k as TurnKind) : null
}

export function isOutputFollowupTurn(turnKind: unknown): boolean {
  return parseTurnKind(turnKind) === 'output_followup'
}

export function parseTurnScopeMode(raw: unknown): TurnScopeMode | null {
  const m = String(raw ?? '').trim()
  return (TURN_SCOPE_MODES as readonly string[]).includes(m) ? (m as TurnScopeMode) : null
}

export function shouldSuppressHistory(mode: TurnScopeMode | string | undefined | null): boolean {
  const m = parseTurnScopeMode(mode) ?? 'current_only'
  return m === 'current_only' || m === 'topic_shift' || m === 'chitchat'
}

export function shouldSuppressAnchor(mode: TurnScopeMode | string | undefined | null): boolean {
  return shouldSuppressHistory(mode)
}

export function shouldSuppressExperienceReplay(mode: TurnScopeMode | string | undefined | null): boolean {
  return shouldSuppressHistory(mode)
}

export function buildTurnScopePayload(mode: TurnScopeMode, turnKind?: TurnKind | string | null): TurnScopePayload {
  const tk = parseTurnKind(turnKind)
  const outputFollowup = tk === 'output_followup'
  return {
    mode,
    turn_kind: tk ?? undefined,
    suppress_history: outputFollowup ? false : shouldSuppressHistory(mode),
    suppress_anchor: outputFollowup ? false : shouldSuppressAnchor(mode),
    suppress_experience_replay: shouldSuppressExperienceReplay(mode),
    narrow_output_followup: outputFollowup || undefined
  }
}

export function parseTurnScopePayload(raw: unknown): TurnScopePayload | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const mode = parseTurnScopeMode(o.mode)
  if (!mode) return null
  const tk = parseTurnKind(o.turn_kind)
  const outputFollowup = tk === 'output_followup' || o.narrow_output_followup === true
  return {
    mode,
    turn_kind: tk ?? undefined,
    suppress_history: o.suppress_history === true ? true : outputFollowup ? false : shouldSuppressHistory(mode),
    suppress_anchor: o.suppress_anchor === true ? true : outputFollowup ? false : shouldSuppressAnchor(mode),
    suppress_experience_replay:
      o.suppress_experience_replay === true ? true : shouldSuppressExperienceReplay(mode),
    narrow_output_followup: outputFollowup || undefined
  }
}

export function turnScopeFromMeta(meta: unknown): TurnScopePayload | null {
  const o = meta as { turnScopeMode?: unknown; turnKind?: unknown; turn_scope?: unknown } | null | undefined
  const embedded = parseTurnScopePayload(o?.turn_scope)
  if (embedded) return embedded
  const mode = parseTurnScopeMode(o?.turnScopeMode)
  return mode ? buildTurnScopePayload(mode, parseTurnKind(o?.turnKind)) : null
}

export type ContextObservability = {
  turn_scope_mode?: TurnScopeMode | string
  turn_kind?: TurnKind | string
  context_history_turns?: number
  context_chars_used?: number
  condense_applied?: boolean
  narrow_output_followup?: boolean
  experience_replay_count?: number
}

export function mergeContextObservability(
  base: Record<string, unknown> | undefined,
  patch: ContextObservability
): Record<string, unknown> {
  return { ...(base || {}), ...patch }
}

export type TurnScopeHistoryMessage = { role: 'user' | 'assistant'; content: string }

/** 总管编排下：根据 turn_scope 决定传给子 Agent 的 history（output_followup 仅窄 assistant） */
export function resolveOrchestratedClientHistory(
  turnScope: TurnScopePayload | null | undefined,
  clientHistory: TurnScopeHistoryMessage[] | null | undefined
): TurnScopeHistoryMessage[] {
  const rows = (Array.isArray(clientHistory) ? clientHistory : [])
    .map((m) => ({
      role: (m.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
      content: String(m.content ?? '').trim()
    }))
    .filter((m) => m.content)
  if (!turnScope) return []
  if (turnScope.narrow_output_followup) {
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i]!.role === 'assistant') return [rows[i]!]
    }
    return []
  }
  if (turnScope.suppress_history) return []
  return rows.slice(-12)
}

/** 编排模式下是否允许 condense / 多轮 merge（output_followup 允许窄上下文） */
export function allowsOrchestratedDialogMerge(turnScope: TurnScopePayload | null | undefined): boolean {
  if (!turnScope) return false
  if (turnScope.narrow_output_followup) return true
  return !turnScope.suppress_history
}
