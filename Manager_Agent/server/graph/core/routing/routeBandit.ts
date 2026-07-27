import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { applyDeprioritizePreserveOrder } from '#agent-shared/routeAgentOrder'
import { resolveManagerEnvBool } from '../../../utils/platform/managerEnvModes'
import { isEvolutionRoutingHintEnabled } from '../evolution/evolutionRoutingGate'

export type BanditArm = {
  intent: string
  alpha: number
  beta: number
  pulls: number
  lastReward: number
  updatedAt: string
}

export type RouteBanditState = {
  updatedAt: string
  arms: BanditArm[]
}

export type RouteBanditAdvice = {
  enabled: boolean
  exploreSession: boolean
  sampledIntent?: string
  boostIntents: string[]
  deprioritizeIntents: string[]
  intentScores: Record<string, number>
  routerHintBlock: string
}

const BANDIT_FILE = 'manager-route-bandit.json'

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
  'clean'
]

const AGENT_TO_INTENT: Record<string, string> = {
  db: 'db',
  rag: 'rag',
  code: 'code',
  crawler: 'crawler',
  admin: 'admin',
  multimodal: 'multimodal',
  music: 'music',
  video: 'video',
  report: 'report',
  visualize: 'visualize',
  clean: 'clean'
}

/** 收敛期默认关：Bandit 不得在未通过路由矩阵前影响 cap */
export function isRouteBanditEnabled(env: NodeJS.ProcessEnv = process.env) {
  if (!isEvolutionRoutingHintEnabled(env)) return false
  return resolveManagerEnvBool('MANAGER_ROUTE_BANDIT', env)
}

/** Bandit 奖励是否可写入（须 routeMatrixPass 或显式关闭门禁） */
export function shouldRecordRouteBanditReward(signal?: { routeMatrixPass?: boolean }): boolean {
  if (!isRouteBanditEnabled()) return false
  if (!resolveManagerEnvBool('MANAGER_BANDIT_REQUIRES_MATRIX_PASS')) return true
  return signal?.routeMatrixPass === true
}

function banditExplorePercent(): number {
  const n = Number(process.env.MANAGER_ROUTE_BANDIT_EXPLORE_PERCENT ?? 8)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(25, Math.floor(n))
}

function banditPath(policyDir: string) {
  return path.join(policyDir, BANDIT_FILE)
}

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n))
}

function defaultArm(intent: string): BanditArm {
  return {
    intent,
    alpha: 1,
    beta: 1,
    pulls: 0,
    lastReward: 0.5,
    updatedAt: new Date().toISOString()
  }
}

export function sessionUsesBanditExplore(sessionId?: string, percent = banditExplorePercent()): boolean {
  const sid = String(sessionId || '').trim()
  if (!sid || percent <= 0) return false
  if (percent >= 100) return true
  const h = createHash('sha256').update(`route-bandit|${sid}`).digest()
  return h.readUInt32BE(0) % 100 < percent
}

/** Beta 分布 Thompson 采样（轻量近似） */
function sampleBeta(alpha: number, beta: number): number {
  const a = Math.max(0.5, alpha)
  const b = Math.max(0.5, beta)
  const u1 = randomBytes(4).readUInt32BE(0) / 0xffffffff
  const u2 = randomBytes(4).readUInt32BE(0) / 0xffffffff
  const x = Math.pow(u1, 1 / a)
  const y = Math.pow(u2, 1 / b)
  const d = x + y
  return d > 0 ? x / d : 0.5
}

export async function loadRouteBanditState(policyDir: string): Promise<RouteBanditState> {
  try {
    const raw = await fs.readFile(banditPath(policyDir), 'utf8')
    const o = JSON.parse(raw) as RouteBanditState
    const arms = Array.isArray(o?.arms) ? o.arms : []
    const byIntent = new Map(arms.map((a) => [a.intent, a]))
    const merged = KNOWN_INTENTS.map((intent) => byIntent.get(intent) || defaultArm(intent))
    return { updatedAt: String(o?.updatedAt || nowIso()), arms: merged }
  } catch {
    return { updatedAt: nowIso(), arms: KNOWN_INTENTS.map(defaultArm) }
  }
}

function nowIso() {
  return new Date().toISOString()
}

async function saveRouteBanditState(policyDir: string, state: RouteBanditState) {
  await fs.mkdir(policyDir, { recursive: true }).catch(() => undefined)
  await fs.writeFile(
    banditPath(policyDir),
    JSON.stringify({ ...state, updatedAt: nowIso() }, null, 2),
    'utf8'
  )
}

/** 每次 learning signal 写入后更新 arm */
export async function recordBanditReward(
  policyDir: string,
  intent: string,
  reward: number
): Promise<{ updated: boolean }> {
  if (!isRouteBanditEnabled()) return { updated: false }
  const key = String(intent || 'unknown').trim()
  if (!key) return { updated: false }
  const r = clamp01(reward)
  const state = await loadRouteBanditState(policyDir)
  const idx = state.arms.findIndex((a) => a.intent === key)
  const arm = idx >= 0 ? state.arms[idx]! : defaultArm(key)
  arm.alpha += r
  arm.beta += 1 - r
  arm.pulls += 1
  arm.lastReward = Math.round(r * 1000) / 1000
  arm.updatedAt = nowIso()
  if (idx >= 0) state.arms[idx] = arm
  else state.arms.push(arm)
  await saveRouteBanditState(policyDir, state)
  return { updated: true }
}

export async function buildRouteBanditAdvice(
  policyDir: string,
  sessionId?: string
): Promise<RouteBanditAdvice> {
  const empty: RouteBanditAdvice = {
    enabled: isRouteBanditEnabled(),
    exploreSession: false,
    boostIntents: [],
    deprioritizeIntents: [],
    intentScores: {},
    routerHintBlock: ''
  }
  if (!empty.enabled) return empty

  const state = await loadRouteBanditState(policyDir)
  const samples: Array<{ intent: string; sample: number; mean: number; pulls: number }> = []
  for (const arm of state.arms) {
    const mean = arm.alpha / (arm.alpha + arm.beta)
    const sample = sampleBeta(arm.alpha, arm.beta)
    samples.push({ intent: arm.intent, sample, mean, pulls: arm.pulls })
    empty.intentScores[arm.intent] = Math.round(sample * 1000) / 1000
  }

  samples.sort((a, b) => b.sample - a.sample)
  const exploreSession = sessionUsesBanditExplore(sessionId)
  const underSampled = state.arms.filter((a) => a.pulls < 4 && !['multi', 'unknown'].includes(a.intent))
  const lowMean = samples.filter((s) => s.mean < 0.45 && s.pulls >= 5)

  empty.boostIntents = samples
    .filter((s) => s.sample >= 0.58 && s.pulls >= 2)
    .slice(0, 3)
    .map((s) => s.intent)
  empty.deprioritizeIntents = lowMean.slice(0, 3).map((s) => s.intent)

  let sampledIntent: string | undefined
  if (exploreSession && underSampled.length) {
    const pick = underSampled.sort((a, b) => a.pulls - b.pulls)[0]
    sampledIntent = pick?.intent
  } else if (samples[0] && samples[0].sample >= 0.55) {
    sampledIntent = samples[0].intent
  }

  const lines: string[] = []
  if (empty.boostIntents.length) {
    lines.push(`- 近期高回报意图（Bandit）：${empty.boostIntents.join('、')}`)
  }
  if (empty.deprioritizeIntents.length) {
    lines.push(`- 近期低回报意图（Bandit）：${empty.deprioritizeIntents.join('、')}，非用户明确要求时后置`)
  }
  if (exploreSession && sampledIntent) {
    lines.push(`- 本会话为探索分桶：可适度尝试「${sampledIntent}」路径（样本不足或 Thompson 采样领先）`)
  }

  empty.exploreSession = exploreSession
  empty.sampledIntent = sampledIntent
  empty.routerHintBlock = lines.length
    ? ['【路由 Bandit 探索（Thompson 采样，非用户新指令）】', ...lines].join('\n')
    : ''

  return empty
}

export function applyBanditAgentReorder(agents: string[], advice: RouteBanditAdvice): string[] {
  if (!advice.enabled || !agents.length) return agents
  const dep = new Set(advice.deprioritizeIntents)
  return applyDeprioritizePreserveOrder(agents, (a) => dep.has(AGENT_TO_INTENT[a] || a))
}

export function intentForAgent(agent: string): string {
  return AGENT_TO_INTENT[agent] || agent
}
