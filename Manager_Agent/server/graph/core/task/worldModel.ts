import fs from 'node:fs/promises'
import path from 'node:path'
import { buildRouteStrategyAdvice } from '../routing/routeStrategy'
import { loadTaskStack } from './taskStack'
import { buildAutonomousQueueDashboard } from './autonomousQueue'
import { buildUnifiedLearningDashboard } from '../unifiedLearning'
import { buildUserGoalsRecall, isUserGoalsEnabled } from './userGoals'
import { buildRouteBanditAdvice, isRouteBanditEnabled, intentForAgent } from '../routing/routeBandit'
import { buildRoutePolicyRlAdvice, isRoutePolicyRlEnabled } from '../routing/routePolicyRl'
import { buildCausalRouteAdvice, isRouteCausalEnabled } from '../routing/routeCausal'
import { loadRoutePreferences } from '../routing/routePreferences'
import { isEvolutionRoutingHintEnabled } from '../evolution/evolutionRoutingGate'

export type AgentPrediction = {
  success: number
  cost: number
  latency: number
  /** 综合预期分 0..1 */
  score: number
}

export type WorldModelSnapshot = {
  sessionId: string
  updatedAt: string
  risk: number
  benefit: number
  cost: number
  confidence: number
  posture: 'aggressive' | 'balanced' | 'conservative' | 'clarify_first'
  factors: string[]
  agentScores: Record<string, number>
  notes: string[]
  /** P4：用户目标压力 0..1 */
  userGoalPressure?: number
  activeUserGoals?: number
  overdueUserGoals?: number
  /** P4：各 Agent 预期成功/成本/延迟 */
  agentPredictions?: Record<string, AgentPrediction>
  recommendedAgents?: string[]
}

const WM_DIR = 'world-models'

export function isWorldModelEnabled() {
  return String(process.env.MANAGER_WORLD_MODEL ?? '1').trim() !== '0'
}

export function isPredictiveWorldModelEnabled(env: NodeJS.ProcessEnv = process.env) {
  return (
    isWorldModelEnabled() &&
    isEvolutionRoutingHintEnabled(env) &&
    String(env.MANAGER_WORLD_MODEL_PREDICTIVE ?? '1').trim() !== '0'
  )
}

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n))
}

function postureFromScores(risk: number, benefit: number, cost: number): WorldModelSnapshot['posture'] {
  if (risk >= 0.65) return 'clarify_first'
  if (cost >= 0.7 && benefit < 0.5) return 'conservative'
  if (benefit >= 0.72 && risk < 0.4) return 'aggressive'
  return 'balanced'
}

function buildAgentPredictions(input: {
  toolHealth?: unknown
  banditScores: Record<string, number>
  policyRlScores?: Record<string, number>
  causalScores?: Record<string, number>
  prefsPenalty: Record<string, number>
  costPressure: number
}): Record<string, AgentPrediction> {
  const hs = (input.toolHealth as { agents?: Array<{ agent: string; status: string; p95Ms: number }> })?.agents || []
  const out: Record<string, AgentPrediction> = {}
  const agents = hs.length
    ? hs.map((x) => x.agent)
    : ['db', 'rag', 'code', 'crawler', 'admin', 'multimodal', 'music', 'video']

  for (const agent of agents) {
    const row = hs.find((x) => x.agent === agent)
    let success = 0.72
    let latency = 0.25
    if (row) {
      if (row.status === 'down') success = 0.05
      else if (row.status === 'degraded') success = 0.42
      else if (row.p95Ms > 30_000) {
        success = 0.38
        latency = 0.75
      } else if (row.p95Ms > 15_000) {
        success = 0.55
        latency = 0.5
      } else if (row.p95Ms > 8_000) {
        latency = 0.35
      }
    }
    const intent = intentForAgent(agent)
    const bandit = input.banditScores[intent]
    if (typeof bandit === 'number') success = success * 0.55 + bandit * 0.45
    const policyQ = input.policyRlScores?.[intent]
    if (typeof policyQ === 'number') success = success * 0.72 + policyQ * 0.28
    const causal = input.causalScores?.[intent]
    if (typeof causal === 'number') success = success * 0.78 + causal * 0.22
    const penalty = input.prefsPenalty[intent] ?? 0
    success = clamp01(success - penalty * 0.35)
    const cost = clamp01(input.costPressure + (row?.p95Ms ? Math.min(0.35, row.p95Ms / 120_000) : 0.1))
    const score = clamp01(success - cost * 0.28 - latency * 0.18)
    out[agent] = {
      success: Math.round(success * 1000) / 1000,
      cost: Math.round(cost * 1000) / 1000,
      latency: Math.round(latency * 1000) / 1000,
      score: Math.round(score * 1000) / 1000
    }
  }
  return out
}

export async function buildWorldModelSnapshot(
  policyDir: string,
  sessionId: string,
  ctx: { toolHealth?: unknown; userId?: string }
): Promise<WorldModelSnapshot | null> {
  if (!isWorldModelEnabled()) return null
  const sid = String(sessionId || '').trim()
  if (!sid) return null

  const [strategy, learn, stack, autoQ, userGoals, bandit, policyRl, causal, prefs] = await Promise.all([
    buildRouteStrategyAdvice(policyDir, sid, ctx.toolHealth).catch(() => null),
    buildUnifiedLearningDashboard(policyDir, sid).catch(() => null),
    loadTaskStack(policyDir, sid).catch(() => ({ items: [] })),
    buildAutonomousQueueDashboard(policyDir).catch(() => ({ pending: 0, running: 0 })),
    isUserGoalsEnabled() && ctx.userId
      ? buildUserGoalsRecall(policyDir, sid, ctx.userId).catch(() => ({ goals: [], routerText: '' }))
      : Promise.resolve({ goals: [], routerText: '' }),
    isRouteBanditEnabled()
      ? buildRouteBanditAdvice(policyDir, sid).catch(() => ({ intentScores: {} as Record<string, number> }))
      : Promise.resolve({ intentScores: {} as Record<string, number> }),
    isRoutePolicyRlEnabled()
      ? buildRoutePolicyRlAdvice(policyDir, sid).catch(() => ({ intentScores: {} as Record<string, number> }))
      : Promise.resolve({ intentScores: {} as Record<string, number> }),
    isRouteCausalEnabled()
      ? buildCausalRouteAdvice(policyDir, sid).catch(() => ({ intentScores: {} as Record<string, number> }))
      : Promise.resolve({ intentScores: {} as Record<string, number> }),
    loadRoutePreferences(policyDir).catch(() => null)
  ])

  const prefsPenalty: Record<string, number> = {}
  for (const e of prefs?.entries || []) {
    if (e.penalty > 0) prefsPenalty[e.intent] = e.penalty
  }

  const factors: string[] = []
  const notes: string[] = []
  let risk = 0.22
  let benefit = 0.58
  let cost = 0.35

  if (strategy?.suppressCanary) {
    risk += 0.12
    factors.push('quality_pressure')
    notes.push('近期质量/满意度偏低，抑制金丝雀')
  }
  if (strategy?.forceLowCostMode) {
    cost += 0.15
    factors.push('low_cost_mode')
  }
  if (typeof learn?.avgComposite === 'number' && learn.avgComposite < 0.52) {
    risk += 0.14
    benefit -= 0.1
    factors.push('low_composite')
  } else if (typeof learn?.avgComposite === 'number' && learn.avgComposite > 0.75) {
    benefit += 0.08
    factors.push('high_composite')
  }
  if (typeof learn?.avgFeedback === 'number' && learn.avgFeedback < 0.42) {
    risk += 0.1
    factors.push('low_feedback')
  }

  const activeGoals = userGoals.goals.filter((g) => g.status === 'active')
  const overdueGoals = activeGoals.filter((g) => g.deadline && Date.parse(g.deadline) < Date.now())
  let userGoalPressure = 0
  if (activeGoals.length) {
    userGoalPressure = Math.min(1, 0.2 + activeGoals.length * 0.08 + overdueGoals.length * 0.12)
    benefit += Math.min(0.1, activeGoals.length * 0.02)
    factors.push('user_goals_active')
    if (overdueGoals.length) {
      risk += Math.min(0.18, overdueGoals.length * 0.06)
      factors.push('user_goals_overdue')
      notes.push(`用户目标 ${overdueGoals.length} 项逾期`)
    }
  }

  const activeTasks = stack.items.filter((t) => t.status === 'active').length
  const overdue = stack.items.filter((t) => {
    if (!t.deadline || t.status === 'done') return false
    return Date.parse(t.deadline) < Date.now()
  }).length
  if (overdue > 0) {
    risk += Math.min(0.2, overdue * 0.06)
    factors.push('overdue_tasks')
    notes.push(`任务栈 ${overdue} 项逾期`)
  }
  if (activeTasks >= 4) {
    cost += 0.08
    factors.push('busy_task_stack')
  }

  if (Number(autoQ.pending) > 0 || Number(autoQ.running) > 0) {
    factors.push('autonomous_pending')
    notes.push(`自治队列 pending=${autoQ.pending}`)
  }

  const hs = (ctx.toolHealth as { agents?: Array<{ agent: string; status: string; p95Ms: number }> })?.agents || []
  const agentScores: Record<string, number> = {}
  for (const row of hs) {
    let score = 0.75
    if (row.status === 'down') score = 0.05
    else if (row.status === 'degraded') score = 0.45
    else if (row.p95Ms > 30_000) score = 0.35
    else if (row.p95Ms > 15_000) score = 0.55
    agentScores[row.agent] = Math.round(score * 1000) / 1000
    if (score < 0.4) {
      risk += 0.04
      factors.push(`agent_${row.agent}_weak`)
    }
  }

  let agentPredictions: Record<string, AgentPrediction> | undefined
  let recommendedAgents: string[] | undefined
  if (isPredictiveWorldModelEnabled()) {
    agentPredictions = buildAgentPredictions({
      toolHealth: ctx.toolHealth,
      banditScores: bandit.intentScores || {},
      policyRlScores: policyRl.intentScores || {},
      causalScores: causal.intentScores || {},
      prefsPenalty,
      costPressure: cost
    })
    recommendedAgents = Object.entries(agentPredictions)
      .sort((a, b) => b[1].score - a[1].score)
      .slice(0, 5)
      .map(([a]) => a)
    if (recommendedAgents.length) {
      notes.push(`推荐 Agent：${recommendedAgents.slice(0, 4).join(' → ')}`)
    }
  }

  risk = clamp01(risk)
  benefit = clamp01(benefit)
  cost = clamp01(cost)
  const confidence = clamp01(0.55 + (learn?.sampleCount ? Math.min(0.35, Number(learn.sampleCount) / 40) : 0))

  return {
    sessionId: sid,
    updatedAt: new Date().toISOString(),
    risk,
    benefit,
    cost,
    confidence,
    posture: postureFromScores(risk, benefit, cost),
    factors: [...new Set(factors)].slice(0, 12),
    agentScores,
    notes: notes.slice(0, 8),
    userGoalPressure: userGoalPressure > 0 ? Math.round(userGoalPressure * 1000) / 1000 : undefined,
    activeUserGoals: activeGoals.length || undefined,
    overdueUserGoals: overdueGoals.length || undefined,
    agentPredictions,
    recommendedAgents
  }
}

export async function saveWorldModelSnapshot(policyDir: string, snapshot: WorldModelSnapshot) {
  const dir = path.join(policyDir, WM_DIR)
  await fs.mkdir(dir, { recursive: true }).catch(() => undefined)
  await fs.writeFile(path.join(dir, `${snapshot.sessionId}.json`), JSON.stringify(snapshot, null, 2), 'utf8')
}

export async function loadWorldModelSnapshot(policyDir: string, sessionId: string): Promise<WorldModelSnapshot | null> {
  try {
    const raw = await fs.readFile(path.join(policyDir, WM_DIR, `${sessionId}.json`), 'utf8')
    return JSON.parse(raw) as WorldModelSnapshot
  } catch {
    return null
  }
}

export function formatWorldModelBlock(snapshot: WorldModelSnapshot | null): string {
  if (!snapshot) return ''
  const postureZh = {
    aggressive: '积极执行',
    balanced: '均衡',
    conservative: '保守降本',
    clarify_first: '先澄清'
  }[snapshot.posture]
  const topAgents = Object.entries(snapshot.agentScores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([a, s]) => `${a}:${s}`)
    .join(' ')
  const predLines =
    snapshot.agentPredictions && isPredictiveWorldModelEnabled()
      ? Object.entries(snapshot.agentPredictions)
          .sort((a, b) => b[1].score - a[1].score)
          .slice(0, 5)
          .map(([a, p]) => `${a}(成功${p.success.toFixed(2)}/成本${p.cost.toFixed(2)}/延迟${p.latency.toFixed(2)})`)
          .join(' ')
      : ''
  return [
    '【世界模型快照（风险-收益-成本，非用户新指令）】',
    `姿态：${postureZh} | 风险 ${snapshot.risk.toFixed(2)} 收益 ${snapshot.benefit.toFixed(2)} 成本 ${snapshot.cost.toFixed(2)} 置信 ${snapshot.confidence.toFixed(2)}`,
    topAgents ? `Agent 可用度：${topAgents}` : '',
    snapshot.activeUserGoals
      ? `用户目标：${snapshot.activeUserGoals} 项进行中${snapshot.overdueUserGoals ? `，${snapshot.overdueUserGoals} 项逾期` : ''}`
      : '',
    predLines ? `Agent 预期（成功/成本/延迟）：${predLines}` : '',
    snapshot.recommendedAgents?.length && isEvolutionRoutingHintEnabled()
      ? `推荐优先：${snapshot.recommendedAgents.join(' → ')}`
      : '',
    snapshot.notes.length ? `备注：${snapshot.notes.join('；')}` : ''
  ]
    .filter(Boolean)
    .join('\n')
}
