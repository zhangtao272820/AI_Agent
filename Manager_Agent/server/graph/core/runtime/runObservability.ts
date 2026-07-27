import path from 'node:path'
import fs from 'node:fs/promises'
import { listHitlDecisionsForRun, listRunTraceEvents } from '#agent-shared/runTraceStore'
import { listToolCallAuditForRun } from '#agent-shared/toolCallAuditStore'
import { aggregateTokensByTier, type CapabilityTier } from '../agent/capabilityTier'

const WORKER_AGENT_PHASES = new Set([
  'db',
  'rag',
  'code',
  'crawler',
  'gui',
  'admin',
  'multimodal',
  'music',
  'video',
  'clean',
  'visualize',
  'report'
])

export type RunMetricRow = {
  runId?: string
  phase?: string
  ms?: number
  tokens?: number
  usd?: number
  model?: string
  agent?: string
  ts?: string
  extra?: { agent?: string }
}

export type RunPhaseTimelineItem = {
  phase: string
  ms: number
  agent?: string
  tokens?: number
  ts?: string
}

export type RunTokenSummary = {
  totalTokens: number
  totalUsd: number
  byAgent: Record<string, number>
  byPhase: Record<string, number>
  byModel: Record<string, number>
  byModelTier: Record<CapabilityTier, number>
}

export function resolveMetricAgent(rec: RunMetricRow): string | undefined {
  const direct = String(rec?.agent || rec?.extra?.agent || '').trim()
  if (direct) return direct
  const phase = String(rec?.phase || '').trim()
  if (WORKER_AGENT_PHASES.has(phase)) return phase
  if (phase.startsWith('llm:')) return 'manager_llm'
  if (phase.startsWith('execute:')) return phase.slice('execute:'.length) || undefined
  return undefined
}

export async function readRunMetrics(runId: string, dataDir?: string): Promise<RunMetricRow[]> {
  const rid = String(runId || '').trim()
  if (!rid) return []
  const dir = dataDir || path.join(process.cwd(), '.data')
  const p = path.join(dir, 'manager-metrics.jsonl')
  try {
    const t = await fs.readFile(p, 'utf8')
    const out: RunMetricRow[] = []
    for (const line of t.split('\n')) {
      if (!line.trim()) continue
      try {
        const rec = JSON.parse(line) as RunMetricRow
        if (String(rec?.runId || '').trim() === rid) out.push(rec)
      } catch {}
    }
    return out
  } catch {
    return []
  }
}

export function buildRunObservabilityFromMetrics(rows: RunMetricRow[]) {
  const sorted = [...rows].sort((a, b) => String(a.ts || '').localeCompare(String(b.ts || '')))
  const phases: RunPhaseTimelineItem[] = []
  const byAgent: Record<string, number> = {}
  const byPhase: Record<string, number> = {}
  const byModel: Record<string, number> = {}
  let totalTokens = 0
  let totalUsd = 0
  let wallClockMs = 0

  for (const rec of sorted) {
    const phase = String(rec.phase || 'unknown').trim() || 'unknown'
    const ms = Number(rec.ms || 0)
    const tokens = Number(rec.tokens || 0)
    const usd = Number(rec.usd || 0)
    const agent = resolveMetricAgent(rec)
    if (Number.isFinite(ms) && ms > 0) {
      phases.push({
        phase,
        ms,
        agent,
        tokens: Number.isFinite(tokens) && tokens > 0 ? tokens : undefined,
        ts: rec.ts
      })
      wallClockMs += ms
    }
    if (Number.isFinite(tokens) && tokens > 0) {
      totalTokens += tokens
      byPhase[phase] = (byPhase[phase] || 0) + tokens
      const model = String(rec.model || 'unknown').trim() || 'unknown'
      byModel[model] = (byModel[model] || 0) + tokens
      const bucket = agent || phase
      byAgent[bucket] = (byAgent[bucket] || 0) + tokens
    }
    if (Number.isFinite(usd) && usd > 0) totalUsd += usd
  }

  return {
    phases,
    tokenSummary: {
      totalTokens,
      totalUsd: Math.round(totalUsd * 10000) / 10000,
      byAgent,
      byPhase,
      byModel,
      byModelTier: aggregateTokensByTier(sorted)
    },
    wallClockMs
  }
}

export async function buildRunObservabilityPayload(runId: string, dataDir?: string) {
  const rows = await readRunMetrics(runId, dataDir)
  const built = buildRunObservabilityFromMetrics(rows)
  const [traceEvents, hitlDecisions, toolCalls] = await Promise.all([
    listRunTraceEvents(runId).catch(() => []),
    listHitlDecisionsForRun(runId).catch(() => []),
    listToolCallAuditForRun(runId).catch(() => [])
  ])
  return {
    runId,
    phaseTimeline: built.phases,
    tokenSummary: built.tokenSummary,
    wallClockMs: built.wallClockMs,
    traceEvents: traceEvents.map((e) => ({
      id: e.id,
      event: e.event,
      from: e.fromAgent,
      ts: e.ts,
      payload: e.payload
    })),
    hitlDecisions: hitlDecisions.map((d) => ({
      id: d.id,
      decision: d.decision,
      confirmId: d.confirmId,
      reason: d.reason,
      ts: d.ts,
      payload: d.payload
    })),
    toolCalls: toolCalls.map((t) => ({
      id: t.id,
      agent: t.agent,
      toolName: t.toolName,
      ok: t.ok,
      ms: t.ms,
      error: t.error,
      queryPreview: t.queryPreview,
      ts: t.ts
    }))
  }
}
