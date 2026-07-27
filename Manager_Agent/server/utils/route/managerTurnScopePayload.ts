/**
 * turn_scope payload 构建（与 shared/turnScope.ts 保持同步；供 sessionBridge / smoke 使用）
 * SSOT：../../../shared/turnScope.ts
 */
export const TURN_SCOPE_MODES = ['current_only', 'continuation', 'topic_shift', 'chitchat'] as const
export type TurnScopeMode = (typeof TURN_SCOPE_MODES)[number]

export const TURN_KINDS = ['new_task', 'continuation', 'output_followup', 'slot_answer', 'chitchat'] as const
export type TurnKind = (typeof TURN_KINDS)[number]

export type TurnScopePayload = {
  mode: TurnScopeMode
  turn_kind?: TurnKind
  suppress_history: boolean
  suppress_anchor: boolean
  suppress_experience_replay: boolean
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
