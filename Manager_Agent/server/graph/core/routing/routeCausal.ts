import fs from 'node:fs/promises'
import path from 'node:path'
import { readSignals, type UnifiedLearningSignal } from '../unifiedLearning'
import { intentForAgent } from './routeBandit'
import { applyDeprioritizePreserveOrder } from '#agent-shared/routeAgentOrder'
import { isEvolutionRoutingHintEnabled } from '../evolution/evolutionRoutingGate'

export type CausalEdge = {
  from: string
  to: string
  /** 近似平均处理效应：条件均值差 */
  effect: number
  support: number
}

export type RouteCausalGraph = {
  updatedAt: string
  globalMean: number
  sampleCount: number
  edges: CausalEdge[]
  /** intent → 相对全局均值的效应 */
  intentEffects: Record<string, number>
}

export type CausalRouteAdvice = {
  enabled: boolean
  globalMean: number
  harmfulEdges: CausalEdge[]
  helpfulIntents: string[]
  riskyIntents: string[]
  intentScores: Record<string, number>
  routerHintBlock: string
}

const CAUSAL_FILE = 'manager-route-causal.json'

const FACTOR_NODES = ['needs_clarify', 'high_latency', 'implicit_stress', 'low_route_conf'] as const

export function isRouteCausalEnabled(env: NodeJS.ProcessEnv = process.env) {
  if (!isEvolutionRoutingHintEnabled(env)) return false
  return String(env.MANAGER_ROUTE_CAUSAL ?? '1').trim() !== '0'
}

function causalPath(policyDir: string) {
  return path.join(policyDir, CAUSAL_FILE)
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n))
}

const FACTOR_ZH: Record<string, string> = {
  needs_clarify: '需澄清',
  high_latency: '高时延',
  implicit_stress: '隐式负向',
  low_route_conf: '低路由置信'
}

function signalFactors(s: UnifiedLearningSignal): string[] {
  const factors: string[] = []
  if (s.needsClarify) factors.push('needs_clarify')
  if (Number(s.durationMs ?? 0) > 45_000) factors.push('high_latency')
  if (s.signalSource === 'implicit' || s.implicitKind) factors.push('implicit_stress')
  if (Number(s.routeConfidence ?? 1) < 0.45) factors.push('low_route_conf')
  return factors
}

function emptyGraph(): RouteCausalGraph {
  return {
    updatedAt: new Date().toISOString(),
    globalMean: 0.55,
    sampleCount: 0,
    edges: [],
    intentEffects: {}
  }
}

export async function loadRouteCausalGraph(policyDir: string): Promise<RouteCausalGraph> {
  try {
    const raw = await fs.readFile(causalPath(policyDir), 'utf8')
    return JSON.parse(raw) as RouteCausalGraph
  } catch {
    return emptyGraph()
  }
}

async function saveRouteCausalGraph(policyDir: string, graph: RouteCausalGraph) {
  await fs.mkdir(policyDir, { recursive: true }).catch(() => undefined)
  await fs.writeFile(
    causalPath(policyDir),
    JSON.stringify({ ...graph, updatedAt: new Date().toISOString() }, null, 2),
    'utf8'
  )
}

/**
 * 从 learning-signals 重建轻量结构因果图：
 * - 因子 → outcome_low 的均值差（ATT 近似）
 * - intent × 因子 交互对低分的贡献
 */
export async function rebuildRouteCausalGraph(
  policyDir: string,
  maxSignals = 600
): Promise<RouteCausalGraph> {
  if (!isRouteCausalEnabled()) return emptyGraph()
  const signals = await readSignals(policyDir, maxSignals)
  if (signals.length < 8) return emptyGraph()

  const outcomes = signals.map((s) => s.compositeScore)
  const globalMean = outcomes.reduce((a, b) => a + b, 0) / outcomes.length

  const intentEffects: Record<string, number> = {}
  const byIntent = new Map<string, number[]>()
  for (const s of signals) {
    const intent = String(s.intent || 'unknown')
    if (!byIntent.has(intent)) byIntent.set(intent, [])
    byIntent.get(intent)!.push(s.compositeScore)
  }
  for (const [intent, arr] of byIntent) {
    const m = arr.reduce((a, b) => a + b, 0) / arr.length
    intentEffects[intent] = Math.round((m - globalMean) * 1000) / 1000
  }

  const edges: CausalEdge[] = []

  for (const factor of FACTOR_NODES) {
    const withF: number[] = []
    const withoutF: number[] = []
    for (const s of signals) {
      const has = signalFactors(s).includes(factor)
      if (has) withF.push(s.compositeScore)
      else withoutF.push(s.compositeScore)
    }
    if (withF.length >= 3 && withoutF.length >= 3) {
      const effect =
        withF.reduce((a, b) => a + b, 0) / withF.length -
        withoutF.reduce((a, b) => a + b, 0) / withoutF.length
      edges.push({
        from: factor,
        to: 'composite_outcome',
        effect: Math.round(effect * 1000) / 1000,
        support: withF.length
      })
    }
  }

  for (const factor of FACTOR_NODES) {
    for (const [intent, arr] of byIntent) {
      if (arr.length < 4) continue
      const withBoth: number[] = []
      const intentOnly: number[] = []
      for (const s of signals) {
        if (String(s.intent || '') !== intent) continue
        const hasFactor = signalFactors(s).includes(factor)
        if (hasFactor) withBoth.push(s.compositeScore)
        else intentOnly.push(s.compositeScore)
      }
      if (withBoth.length < 2 || intentOnly.length < 2) continue
      const interaction =
        withBoth.reduce((a, b) => a + b, 0) / withBoth.length -
        intentOnly.reduce((a, b) => a + b, 0) / intentOnly.length
      if (Math.abs(interaction) < 0.04) continue
      edges.push({
        from: factor,
        to: `intent_${intent}`,
        effect: Math.round(interaction * 1000) / 1000,
        support: withBoth.length
      })
    }
  }

  edges.sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect))

  const graph: RouteCausalGraph = {
    updatedAt: new Date().toISOString(),
    globalMean: Math.round(globalMean * 1000) / 1000,
    sampleCount: signals.length,
    edges: edges.slice(0, 32),
    intentEffects
  }
  await saveRouteCausalGraph(policyDir, graph)
  return graph
}

export async function maybeRefreshRouteCausalGraph(policyDir: string): Promise<{ refreshed: boolean }> {
  if (!isRouteCausalEnabled()) return { refreshed: false }
  const minInterval = Number(process.env.MANAGER_ROUTE_CAUSAL_REFRESH_MS ?? 600_000)
  const graph = await loadRouteCausalGraph(policyDir)
  const age = Date.now() - Date.parse(graph.updatedAt || '0')
  if (graph.sampleCount > 0 && Number.isFinite(age) && age < minInterval) {
    return { refreshed: false }
  }
  const next = await rebuildRouteCausalGraph(policyDir)
  return { refreshed: next.sampleCount > 0 }
}

export async function buildCausalRouteAdvice(
  policyDir: string,
  sessionId?: string
): Promise<CausalRouteAdvice> {
  const empty: CausalRouteAdvice = {
    enabled: isRouteCausalEnabled(),
    globalMean: 0.55,
    harmfulEdges: [],
    helpfulIntents: [],
    riskyIntents: [],
    intentScores: {},
    routerHintBlock: ''
  }
  if (!empty.enabled) return empty

  let graph = await loadRouteCausalGraph(policyDir)
  if (graph.sampleCount < 8) {
    graph = await rebuildRouteCausalGraph(policyDir).catch(() => graph)
  }
  empty.globalMean = graph.globalMean

  const harmful = graph.edges
    .filter((e) => e.to === 'composite_outcome' && e.effect < -0.05)
    .slice(0, 4)
  empty.harmfulEdges = harmful

  const helpful = Object.entries(graph.intentEffects)
    .filter(([, e]) => e >= 0.06)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([i]) => i)
  const risky = Object.entries(graph.intentEffects)
    .filter(([, e]) => e <= -0.08)
    .sort((a, b) => a[1] - b[1])
    .slice(0, 3)
    .map(([i]) => i)
  empty.helpfulIntents = helpful
  empty.riskyIntents = risky

  for (const [intent, effect] of Object.entries(graph.intentEffects)) {
    empty.intentScores[intent] = clamp(0.5 + effect, 0.05, 0.95)
  }

  const sessionFactors = new Set<string>()
  if (sessionId) {
    const signals = await readSignals(policyDir, 200).catch(() => [] as UnifiedLearningSignal[])
    const sess = signals.filter((s) => s.sessionId === sessionId).slice(-6)
    for (const s of sess) {
      for (const f of signalFactors(s)) sessionFactors.add(f)
    }
  }

  const interactionLines: string[] = []
  for (const e of graph.edges) {
    if (!e.to.startsWith('intent_')) continue
    if (sessionFactors.size && !sessionFactors.has(e.from)) continue
    const intent = e.to.replace(/^intent_/, '')
    if (Math.abs(e.effect) < 0.06) continue
    const dir = e.effect < 0 ? '降低' : '提升'
    interactionLines.push(
      `${FACTOR_ZH[e.from] || e.from} 条件下「${intent}」综合分因果效应 ${dir} ${Math.abs(e.effect).toFixed(2)}（n=${e.support}）`
    )
    if (interactionLines.length >= 3) break
  }

  const lines: string[] = []
  if (harmful.length) {
    lines.push(
      `- 全局风险因子：${harmful
        .map((e) => `${FACTOR_ZH[e.from] || e.from}→综合分 ${e.effect.toFixed(2)}`)
        .join('；')}`
    )
  }
  if (helpful.length) {
    lines.push(`- 因果图高回报意图：${helpful.join('、')}`)
  }
  if (risky.length) {
    lines.push(`- 因果图低回报意图：${risky.join('、')}，非用户明确要求时后置`)
  }
  if (interactionLines.length) {
    lines.push(`- 会话相关交互：${interactionLines.join('；')}`)
  }
  if (graph.sampleCount >= 8) {
    lines.push(`- 因果图样本 ${graph.sampleCount}，全局均值 ${graph.globalMean.toFixed(2)}`)
  }

  empty.routerHintBlock = lines.length
    ? ['【路由因果图（结构因果，跨会话，非用户新指令）】', ...lines].join('\n')
    : ''

  return empty
}

export function applyCausalAgentReorder(agents: string[], advice: CausalRouteAdvice): string[] {
  if (!advice.enabled || !agents.length) return agents
  const risky = new Set(advice.riskyIntents)
  return applyDeprioritizePreserveOrder(agents, (a) => risky.has(intentForAgent(a)))
}

/** 单条信号写入后标记因果图待刷新（由后台 tick 批量重建） */
export async function touchRouteCausalDirty(policyDir: string) {
  if (!isRouteCausalEnabled()) return
  const graph = await loadRouteCausalGraph(policyDir)
  if (graph.sampleCount === 0) {
    await rebuildRouteCausalGraph(policyDir, 400).catch(() => undefined)
  }
}
