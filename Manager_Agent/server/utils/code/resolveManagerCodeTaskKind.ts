import type { ManagerCodeTaskKind } from '#agent-shared/managerTaskEnvelope'

const VALID_KINDS = new Set<ManagerCodeTaskKind>(['compute', 'inspect', 'edit', 'script'])

function normalizeCodeTaskKind(raw: unknown): ManagerCodeTaskKind | null {
  const k = String(raw ?? '').trim().toLowerCase()
  if (k === 'auto' || !k) return null
  return VALID_KINDS.has(k as ManagerCodeTaskKind) ? (k as ManagerCodeTaskKind) : null
}

function codeModeFromBlueprint(meta: unknown): ManagerCodeTaskKind | null {
  const bp = (meta as { planBlueprint?: { steps?: Array<{ agent?: string; codeMode?: string }> } } | null)
    ?.planBlueprint
  const step = bp?.steps?.find((s) => String(s?.agent ?? '').trim() === 'code')
  return normalizeCodeTaskKind(step?.codeMode)
}

/**
 * 总管侧 Code task_kind 解析（结构字段优先，不用用户原话 regex）。
 * 优先级：显式 taskKind → meta.codeMode → 蓝图 code 步 → 有上游 → 默认 env。
 */
export function resolveManagerCodeTaskKind(input: {
  question: string
  upstreamContext?: string
  explicitTaskKind?: string
  meta?: unknown
}): ManagerCodeTaskKind {
  const explicit = normalizeCodeTaskKind(input.explicitTaskKind)
  if (explicit) return explicit

  const meta = input.meta as Record<string, unknown> | null
  const metaMode = normalizeCodeTaskKind(meta?.codeMode ?? meta?.code_mode)
  if (metaMode) return metaMode

  const blueprintMode = codeModeFromBlueprint(input.meta)
  if (blueprintMode) return blueprintMode

  const upstream = String(input.upstreamContext ?? '').trim()
  if (upstream) return 'compute'

  const envDefault = normalizeCodeTaskKind(process.env.MANAGER_CODE_DEFAULT_MODE)
  return envDefault ?? 'inspect'
}
