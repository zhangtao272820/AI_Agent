export type PrefetchGateState = {
  intent?: string
  allowedAgents?: string[]
  meta?: unknown
  routedQuery?: string
  messages?: unknown[]
}

export type PrefetchTargets = {
  db: boolean
  rag: boolean
}

function normalizeAllowed(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const x of raw) {
    const a = String(x ?? '').trim()
    if (!a || seen.has(a)) continue
    seen.add(a)
    out.push(a)
  }
  return out
}

/**
 * 预取跟路由模型对齐：allowedAgents 含 db/rag 才预取对应源。
 * allowedAgents 为空时回退 intent=db/rag；不因 probe 命中单独触发。
 */
export function resolvePrefetchTargets(state: PrefetchGateState): PrefetchTargets {
  const allowed = normalizeAllowed(state.allowedAgents)
  if (allowed.length > 0) {
    return {
      db: allowed.includes('db'),
      rag: allowed.includes('rag')
    }
  }
  const intent = String(state.intent || '').trim()
  return {
    db: intent === 'db',
    rag: intent === 'rag'
  }
}

export function formatPrefetchTargets(targets: PrefetchTargets): string {
  const parts: string[] = []
  if (targets.db) parts.push('DB')
  if (targets.rag) parts.push('RAG')
  return parts.length ? parts.join('+') : '无'
}
