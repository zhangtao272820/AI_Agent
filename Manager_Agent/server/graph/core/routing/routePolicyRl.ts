import fs from 'node:fs/promises'
import path from 'node:path'
import { readSignals, type UnifiedLearningSignal } from '../unifiedLearning'
import { intentForAgent } from './routeBandit'
import { applyDeprioritizePreserveOrder } from '#agent-shared/routeAgentOrder'
import { isEvolutionRoutingHintEnabled } from '../evolution/evolutionRoutingGate'

export type PolicyIntentArm = {
  q: number
  n: number
  lastAdvantage: number
  updatedAt: string
}

export type RoutePolicyRlState = {
  updatedAt: string
  baseline: number
  totalUpdates: number
  intents: Record<string, PolicyIntentArm>
  /** 上下文桶 → intent → Q */
  contextBuckets: Record<string, Record<string, { q: number; n: number }>>
}

export type RoutePolicyRlAdvice = {
  enabled: boolean
  baseline: number
  activeBuckets: string[]
  boostIntents: string[]
  deprioritizeIntents: string[]
  intentScores: Record<string, number>
  routerHintBlock: string
}

const POLICY_FILE = 'manager-route-policy.json'

const KNOWN_INTENTS = [
  'db',
  'rag',
  'code',
  'crawler',
  'admin',
  'multimodal',
  'music',
  'video',
  'multi',
  'report',
  'visualize',
  'clean',
  'unknown'
]

const BUCKET_LABELS: Record<string, string> = {
  global: '全局',
  clarify: '需澄清',
  slow: '高时延',
  implicit: '隐式负向',
  first_pass: '一次通过'
}

export function isRoutePolicyRlEnabled(env: NodeJS.ProcessEnv = process.env) {
  if (!isEvolutionRoutingHintEnabled(env)) return false
  return String(env.MANAGER_ROUTE_POLICY_RL ?? '1').trim() !== '0'
}

function learningRate() {
  const n = Number(process.env.MANAGER_ROUTE_POLICY_RL_LR ?? 0.08)
  return Number.isFinite(n) && n > 0 ? Math.min(0.25, n) : 0.08
}

function policyPath(policyDir: string) {
  return path.join(policyDir, POLICY_FILE)
}

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n))
}

function nowIso() {
  return new Date().toISOString()
}

function defaultArm(): PolicyIntentArm {
  return { q: 0.5, n: 0, lastAdvantage: 0, updatedAt: nowIso() }
}

function defaultState(): RoutePolicyRlState {
  return {
    updatedAt: nowIso(),
    baseline: 0.55,
    totalUpdates: 0,
    intents: Object.fromEntries(KNOWN_INTENTS.map((i) => [i, defaultArm()])),
    contextBuckets: {}
  }
}

export function deriveContextBuckets(signal: UnifiedLearningSignal): string[] {
  const buckets = new Set<string>(['global'])
  if (signal.needsClarify) buckets.add('clarify')
  if (Number(signal.durationMs ?? 0) > 45_000) buckets.add('slow')
  if (signal.signalSource === 'implicit' || signal.implicitKind) buckets.add('implicit')
  if (signal.firstPassSuccess) buckets.add('first_pass')
  return [...buckets]
}

export async function loadRoutePolicyRlState(policyDir: string): Promise<RoutePolicyRlState> {
  try {
    const raw = await fs.readFile(policyPath(policyDir), 'utf8')
    const o = JSON.parse(raw) as RoutePolicyRlState
    const base = defaultState()
    return {
      ...base,
      ...o,
      intents: { ...base.intents, ...(o.intents || {}) },
      contextBuckets: o.contextBuckets || {}
    }
  } catch {
    return defaultState()
  }
}

async function saveRoutePolicyRlState(policyDir: string, state: RoutePolicyRlState) {
  await fs.mkdir(policyDir, { recursive: true }).catch(() => undefined)
  await fs.writeFile(
    policyPath(policyDir),
    JSON.stringify({ ...state, updatedAt: nowIso() }, null, 2),
    'utf8'
  )
}

/** 跨会话在线策略梯度：reward = compositeScore，advantage 相对 EMA baseline */
export async function recordPolicyRlUpdate(
  policyDir: string,
  signal: UnifiedLearningSignal
): Promise<{ updated: boolean }> {
  if (!isRoutePolicyRlEnabled()) return { updated: false }
  const intent = String(signal.intent || 'unknown').trim() || 'unknown'
  const reward = clamp01(signal.compositeScore)
  const lr = learningRate()
  const state = await loadRoutePolicyRlState(policyDir)

  state.baseline = state.baseline * 0.97 + reward * 0.03
  const advantage = reward - state.baseline
  state.totalUpdates += 1

  const arm = state.intents[intent] || defaultArm()
  arm.q = clamp01(arm.q + lr * advantage)
  arm.n += 1
  arm.lastAdvantage = Math.round(advantage * 1000) / 1000
  arm.updatedAt = nowIso()
  state.intents[intent] = arm

  for (const bucket of deriveContextBuckets(signal)) {
    if (!state.contextBuckets[bucket]) state.contextBuckets[bucket] = {}
    const row = state.contextBuckets[bucket][intent] || { q: 0.5, n: 0 }
    const bucketLr = bucket === 'global' ? lr : lr * 1.15
    row.q = clamp01(row.q + bucketLr * advantage)
    row.n += 1
    state.contextBuckets[bucket][intent] = row
  }

  await saveRoutePolicyRlState(policyDir, state)
  return { updated: true }
}

function scoreIntent(
  state: RoutePolicyRlState,
  intent: string,
  activeBuckets: string[]
): number {
  const globalQ = state.intents[intent]?.q ?? 0.5
  if (!activeBuckets.length) return globalQ
  let sum = globalQ * 0.35
  let w = 0.35
  for (const bucket of activeBuckets) {
    if (bucket === 'global') continue
    const row = state.contextBuckets[bucket]?.[intent]
    if (row && row.n >= 2) {
      sum += row.q * 0.22
      w += 0.22
    }
  }
  return w > 0 ? sum / w : globalQ
}

/** 根据会话近期信号推断当前上下文桶 */
export async function inferSessionContextBuckets(
  policyDir: string,
  sessionId?: string
): Promise<string[]> {
  const buckets = new Set<string>(['global'])
  if (!sessionId) return ['global']
  const signals = await readSignals(policyDir, 300).catch(() => [] as UnifiedLearningSignal[])
  const sess = signals.filter((s) => s.sessionId === sessionId).slice(-8)
  if (!sess.length) return ['global']
  const clarifyRate = sess.filter((s) => s.needsClarify).length / sess.length
  const slowRate = sess.filter((s) => Number(s.durationMs ?? 0) > 45_000).length / sess.length
  const implicitRate = sess.filter((s) => s.signalSource === 'implicit' || s.implicitKind).length / sess.length
  if (clarifyRate >= 0.35) buckets.add('clarify')
  if (slowRate >= 0.3) buckets.add('slow')
  if (implicitRate >= 0.25) buckets.add('implicit')
  if (sess.filter((s) => s.firstPassSuccess).length / sess.length >= 0.6) buckets.add('first_pass')
  return [...buckets]
}

export async function buildRoutePolicyRlAdvice(
  policyDir: string,
  sessionId?: string
): Promise<RoutePolicyRlAdvice> {
  const empty: RoutePolicyRlAdvice = {
    enabled: isRoutePolicyRlEnabled(),
    baseline: 0.55,
    activeBuckets: ['global'],
    boostIntents: [],
    deprioritizeIntents: [],
    intentScores: {},
    routerHintBlock: ''
  }
  if (!empty.enabled) return empty

  const [state, activeBuckets] = await Promise.all([
    loadRoutePolicyRlState(policyDir),
    inferSessionContextBuckets(policyDir, sessionId)
  ])
  empty.baseline = Math.round(state.baseline * 1000) / 1000
  empty.activeBuckets = activeBuckets

  const ranked = KNOWN_INTENTS.filter((i) => i !== 'unknown')
    .map((intent) => ({
      intent,
      score: scoreIntent(state, intent, activeBuckets),
      n: state.intents[intent]?.n ?? 0
    }))
    .sort((a, b) => b.score - a.score)

  for (const r of ranked) {
    empty.intentScores[r.intent] = Math.round(r.score * 1000) / 1000
  }

  empty.boostIntents = ranked
    .filter((r) => r.score >= 0.58 && r.n >= 3)
    .slice(0, 3)
    .map((r) => r.intent)
  empty.deprioritizeIntents = ranked
    .filter((r) => r.score < 0.42 && r.n >= 5)
    .slice(-3)
    .map((r) => r.intent)

  const bucketZh = activeBuckets
    .filter((b) => b !== 'global')
    .map((b) => BUCKET_LABELS[b] || b)
    .join('、')
  const lines: string[] = []
  if (empty.boostIntents.length) {
    lines.push(`- 策略梯度高 Q 意图：${empty.boostIntents.join('、')}（baseline ${empty.baseline.toFixed(2)}）`)
  }
  if (empty.deprioritizeIntents.length) {
    lines.push(`- 策略梯度低 Q 意图：${empty.deprioritizeIntents.join('、')}，非用户明确要求时后置`)
  }
  if (bucketZh) {
    lines.push(`- 当前会话上下文桶：${bucketZh}（跨会话 contextual Q 加权）`)
  }
  if (state.totalUpdates >= 10) {
    lines.push(`- 累计策略更新 ${state.totalUpdates} 次（全用户 learning-signals 驱动）`)
  }

  empty.routerHintBlock = lines.length
    ? ['【路由策略梯度（在线 RL，跨会话，非用户新指令）】', ...lines].join('\n')
    : ''

  return empty
}

export function applyPolicyRlAgentReorder(agents: string[], advice: RoutePolicyRlAdvice): string[] {
  if (!advice.enabled || !agents.length) return agents
  const dep = new Set(advice.deprioritizeIntents)
  return applyDeprioritizePreserveOrder(agents, (a) => dep.has(intentForAgent(a)))
}
