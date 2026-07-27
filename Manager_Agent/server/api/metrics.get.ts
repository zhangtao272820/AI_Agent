import path from 'node:path'
import { buildManagerMetricsDashboard } from '../graph/core/runtime/metricsAggregate'
import { buildAgentRegistry } from '../graph/core/agent/agentRegistry'
import { isPolicyCanaryEnabled, policyCanaryPercent } from '../graph/core/evolution/policyCanary'
import { promptCanaryPercent, plannerRulesCanaryPercent } from '../graph/core/evolution/artifactCanary'
import { isEvolutionAutoExperimentEnabled } from '../graph/core/evolution/evolutionExperiments'

import { aggregateTokensByTier } from '../graph/core/agent/capabilityTier'

const WORKER_AGENT_PHASES = new Set([
  'db',
  'rag',
  'code',
  'crawler',
  'admin',
  'multimodal',
  'music',
  'video',
  'clean',
  'report'
])

function resolveMetricAgent(rec: Record<string, unknown>): string | null {
  const direct = String(rec?.agent || '').trim()
  if (direct) return direct
  const extra = rec?.extra
  if (extra && typeof extra === 'object') {
    const fromExtra = String((extra as Record<string, unknown>).agent || '').trim()
    if (fromExtra) return fromExtra
  }
  const phase = String(rec?.phase || '').trim()
  if (WORKER_AGENT_PHASES.has(phase)) return phase
  return null
}

export default defineEventHandler(async () => {
  const policyDir = path.join(process.cwd(), '.data')
  const memJsonlPath = path.join(policyDir, 'manager-memory.jsonl')
  const memJsonPath = path.join(policyDir, 'manager-memory.json')
  const metJsonlPath = path.join(policyDir, 'manager-metrics.jsonl')
  const metJsonPath = path.join(policyDir, 'manager-metrics.json')
  const fs = await import('node:fs/promises')
  const readJson = async (p: string) => {
    try {
      const t = await fs.readFile(p, 'utf8')
      return t.trim() ? JSON.parse(t) : null
    } catch {
      return null
    }
  }
  const readJsonl = async (p: string, maxLines = 800) => {
    const t = await fs.readFile(p, 'utf8').catch(() => '')
    if (!t.trim()) return []
    const lines = t.split('\n').filter((l) => l.trim()).slice(-Math.max(1, maxLines))
    const out: any[] = []
    for (const line of lines) {
      try {
        out.push(JSON.parse(line))
      } catch {}
    }
    return out
  }

  const memJsonl = await readJsonl(memJsonlPath, 400)
  const memoryEntries = memJsonl.length ? memJsonl : (((await readJson(memJsonPath))?.history as any[]) ?? [])

  const metJsonl = await readJsonl(metJsonlPath, 1200)
  let metricEntries: any[] = metJsonl
  if (!metricEntries.length) {
    const obj = (await readJson(metJsonPath)) as any
    const runs = obj?.runs ? Object.keys(obj.runs) : []
    const out: any[] = []
    for (const id of runs) {
      const arr = Array.isArray(obj.runs[id]) ? obj.runs[id] : []
      for (const rec of arr) out.push({ runId: id, ...rec })
    }
    metricEntries = out
  }

  const runIds = new Set<string>()
  const phaseAgg: Record<string, { count: number; totalMs: number }> = {}
  let totalTokens = 0
  let totalUsd = 0
  const tokensByPhase: Record<string, number> = {}
  const tokensByAgent: Record<string, number> = {}
  const tokensByModel: Record<string, number> = {}
  const recentMetrics: Array<{
    ts?: string
    runId?: string
    phase?: string
    ms?: number
    tokens?: number
    usd?: number
    model?: string
  }> = []
  for (const rec of Array.isArray(metricEntries) ? metricEntries : []) {
    const runId = String(rec?.runId ?? '').trim()
    if (runId) runIds.add(runId)
    const k = String(rec?.phase || 'unknown')
    const ms = Number(rec?.ms || 0)
    if (!phaseAgg[k]) phaseAgg[k] = { count: 0, totalMs: 0 }
    phaseAgg[k].count += 1
    phaseAgg[k].totalMs += Number.isFinite(ms) ? ms : 0
    const tok = Number(rec?.tokens || 0)
    if (Number.isFinite(tok) && tok > 0) {
      totalTokens += tok
      tokensByPhase[k] = (tokensByPhase[k] || 0) + tok
      const agentBucket = resolveMetricAgent(rec as Record<string, unknown>)
      if (agentBucket) tokensByAgent[agentBucket] = (tokensByAgent[agentBucket] || 0) + tok
      const model = String(rec?.model || 'unknown').trim() || 'unknown'
      tokensByModel[model] = (tokensByModel[model] || 0) + tok
    }
    const usd = Number(rec?.usd || 0)
    if (Number.isFinite(usd) && usd > 0) totalUsd += usd
    recentMetrics.push({
      ts: typeof rec?.ts === 'string' ? rec.ts : undefined,
      runId: runId || undefined,
      phase: k,
      ms: Number.isFinite(ms) ? ms : undefined,
      tokens: Number.isFinite(tok) && tok > 0 ? tok : undefined,
      usd: Number.isFinite(usd) && usd > 0 ? usd : undefined,
      model: typeof rec?.model === 'string' ? rec.model : undefined
    })
  }
  const summary: Record<string, { count: number; avgMs: number }> = {}
  for (const [k, v] of Object.entries(phaseAgg)) {
    summary[k] = { count: v.count, avgMs: v.count ? Math.round(v.totalMs / v.count) : 0 }
  }
  recentMetrics.sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || '')))

  const dashboard = await buildManagerMetricsDashboard(policyDir).catch(() => null)

  let toolHealth: unknown = null
  try {
    const raw = await fs.readFile(path.join(policyDir, 'manager-tool-health.json'), 'utf8')
    toolHealth = JSON.parse(raw)
  } catch {}

  return {
    ok: true,
    runs: runIds.size,
    phases: summary,
    tokenSummary: {
      totalTokens,
      totalUsd: Math.round(totalUsd * 10000) / 10000,
      byPhase: tokensByPhase,
      byModel: tokensByModel,
      byAgent: tokensByAgent,
      byModelTier: aggregateTokensByTier(
        (Array.isArray(metricEntries) ? metricEntries : []).map((rec) => ({
          model: rec?.model,
          tokens: rec?.tokens
        }))
      )
    },
    recentMetrics: recentMetrics.slice(0, 60),
    memory: Array.isArray(memoryEntries) ? memoryEntries.slice(-20) : [],
    evolution: dashboard,
    agentRegistry: buildAgentRegistry(),
    toolHealth,
    policyCanary: {
      enabled: isPolicyCanaryEnabled(),
      percent: policyCanaryPercent()
    },
    promptCanary: {
      percent: promptCanaryPercent()
    },
    plannerRulesCanary: {
      percent: plannerRulesCanaryPercent()
    },
    evolutionAutoExperiment: isEvolutionAutoExperimentEnabled()
  }
})
