import fs from 'node:fs/promises'
import path from 'node:path'
import { readHistoryEntries } from '../shared'
import { normalizeFeedbackScore } from '../runtime/runtimePersistence'
import { buildEvolutionVersionLift } from '../evolution/evolutionVersionLift'
import { applyRetryImplicitPenalty, isImplicitLearningEnabled } from '../evolution/implicitLearning'
import { isRouteBanditEnabled, recordBanditReward, shouldRecordRouteBanditReward } from '../routing/routeBandit'
import { isRoutePolicyRlEnabled, recordPolicyRlUpdate } from '../routing/routePolicyRl'
import { isRouteCausalEnabled, touchRouteCausalDirty } from '../routing/routeCausal'
import { interactionModeFromMeta } from '../runtime/modeIsolate'



export type UnifiedLearningSignal = {
  ts: string
  runId: string
  sessionId?: string
  intent: string
  /** 综合质量分 0..1 */
  compositeScore: number
  finalConfidence: number
  routeConfidence: number
  successScore: number
  feedbackScore?: number
  durationMs: number
  usedTokens: number
  usedUsd: number
  firstPassSuccess: boolean
  needsClarify: boolean
  failureCategory?: string
  policyVersion?: number
  policyCanary?: boolean
  promptCanary?: boolean
  plannerRulesCanary?: boolean
  /** 阶段耗时均值（ms），来自 manager-metrics.jsonl */
  avgPhaseMs?: number
  slowestPhase?: string
  /** run 正常完成 | 显式反馈 | 隐式行为 */
  signalSource?: 'run' | 'explicit_feedback' | 'implicit'
  /** 隐式负向类型（cancel/interrupt/reject/retry） */
  implicitKind?: 'user_cancel' | 'new_chat_interrupt' | 'human_reject' | 'retry_penalty'
  /** P3：联网搜索指标 */
  webSearchMode?: string
  needsWebSearch?: boolean
  searchRequested?: boolean
  searchHitCount?: number
  seedUrlCount?: number
  searchRounds?: number
  searchFailed?: boolean
  /** 离线路由矩阵 PASS 标记；Bandit 收敛期仅计入 routeMatrixPass=true 的 run */
  routeMatrixPass?: boolean
  /** 统一编排来源（full_llm / reflex / probe_heuristic 等） */
  orchestratorSource?: string
  orchestratorJudgeAccept?: boolean
  orchestratorReflexRetries?: number
  /** P1：工作台 interactionMode 分桶 */
  interactionMode?: 'chat' | 'professional'
}

export const SIGNAL_FILE = 'manager-learning-signals.jsonl'
const WEIGHTS_FILE = 'manager-learning-weights.json'

export type LearningWeights = {
  final: number
  route: number
  success: number
  feedback: number
  tunedAt?: string
  reason?: string
}

let weightCache: { w: LearningWeights; loadedAt: number } | null = null

export function isUnifiedLearningEnabled() {
  return String(process.env.MANAGER_UNIFIED_LEARNING ?? '1').trim() !== '0'
}

export function isLearningWeightTuneEnabled() {
  return String(process.env.MANAGER_LEARNING_WEIGHT_TUNE ?? '1').trim() !== '0'
}

export function maxSignalLines() {
  const n = Number(process.env.MANAGER_UNIFIED_LEARNING_MAX_LINES ?? 2000)
  return Number.isFinite(n) && n >= 200 ? Math.min(8000, Math.floor(n)) : 2000
}

function defaultWeightsFromEnv(): LearningWeights {
  const wFinal = Number(process.env.MANAGER_LEARNING_WEIGHT_FINAL ?? 0.35)
  const wRoute = Number(process.env.MANAGER_LEARNING_WEIGHT_ROUTE ?? 0.15)
  const wSuccess = Number(process.env.MANAGER_LEARNING_WEIGHT_SUCCESS ?? 0.3)
  const wFeedback = Number(process.env.MANAGER_LEARNING_WEIGHT_FEEDBACK ?? 0.2)
  return {
    final: Number.isFinite(wFinal) ? wFinal : 0.35,
    route: Number.isFinite(wRoute) ? wRoute : 0.15,
    success: Number.isFinite(wSuccess) ? wSuccess : 0.3,
    feedback: Number.isFinite(wFeedback) ? wFeedback : 0.2
  }
}

export function normalizeWeights(raw: Partial<LearningWeights>): LearningWeights {
  const base = defaultWeightsFromEnv()
  const w = {
    final: Number(raw.final ?? base.final),
    route: Number(raw.route ?? base.route),
    success: Number(raw.success ?? base.success),
    feedback: Number(raw.feedback ?? base.feedback)
  }
  const sum = w.final + w.route + w.success + w.feedback
  if (!Number.isFinite(sum) || sum <= 0) return base
  return {
    final: w.final / sum,
    route: w.route / sum,
    success: w.success / sum,
    feedback: w.feedback / sum,
    tunedAt: raw.tunedAt,
    reason: raw.reason
  }
}

export function getCachedLearningWeights(): LearningWeights {
  if (weightCache && Date.now() - weightCache.loadedAt < 60_000) return weightCache.w
  return defaultWeightsFromEnv()
}

export async function refreshLearningWeightsCache(policyDir: string) {
  const p = path.join(policyDir, WEIGHTS_FILE)
  try {
    const raw = await fs.readFile(p, 'utf8')
    const o = JSON.parse(raw) as Partial<LearningWeights>
    const w = normalizeWeights(o)
    weightCache = { w, loadedAt: Date.now() }
    return w
  } catch {
    const w = defaultWeightsFromEnv()
    weightCache = { w, loadedAt: Date.now() }
    return w
  }
}

export async function persistLearningWeights(policyDir: string, weights: LearningWeights) {
  await fs.mkdir(policyDir, { recursive: true }).catch(() => undefined)
  await fs.writeFile(path.join(policyDir, WEIGHTS_FILE), JSON.stringify(weights, null, 2), 'utf8')
  weightCache = { w: weights, loadedAt: Date.now() }
}

function weights() {
  return getCachedLearningWeights()
}

export async function getEffectiveLearningWeights(policyDir: string): Promise<LearningWeights> {
  await refreshLearningWeightsCache(policyDir).catch(() => undefined)
  return getCachedLearningWeights()
}

export function clamp01(n: number) {
  return Math.max(0, Math.min(1, n))
}

export function computeCompositeScore(input: {
  finalConfidence: number
  routeConfidence: number
  successScore: number
  feedbackScore?: number | null
  durationMs?: number
  firstPassSuccess?: boolean
}) {
  const w = weights()
  const final = clamp01(input.finalConfidence)
  const route = clamp01(input.routeConfidence)
  const success = clamp01(input.successScore)
  let fb = input.feedbackScore
  if (fb == null || !Number.isFinite(fb)) fb = success
  else fb = clamp01(fb)

  let composite = w.final * final + w.route * route + w.success * success + w.feedback * fb
  if (input.firstPassSuccess) composite += 0.03
  const dur = Number(input.durationMs ?? 0)
  if (dur > 90_000) composite -= 0.04
  else if (dur > 45_000) composite -= 0.02
  return Math.round(clamp01(composite) * 1000) / 1000
}

async function phaseStatsForRun(policyDir: string, runId: string) {
  const p = path.join(policyDir, 'manager-metrics.jsonl')
  const raw = await fs.readFile(p, 'utf8').catch(() => '')
  if (!raw.trim()) return { avgPhaseMs: undefined as number | undefined, slowestPhase: undefined as string | undefined }
  const lines = raw.split('\n').filter((l) => l.trim()).slice(-800)
  const byPhase: Record<string, number[]> = {}
  for (const line of lines) {
    try {
      const o = JSON.parse(line)
      if (String(o?.runId || '') !== runId) continue
      const phase = String(o?.phase || 'unknown')
      const ms = Number(o?.ms ?? 0)
      if (!Number.isFinite(ms) || ms <= 0) continue
      if (!byPhase[phase]) byPhase[phase] = []
      byPhase[phase].push(ms)
    } catch {}
  }
  const entries = Object.entries(byPhase)
  if (!entries.length) return {}
  let slowest = 'unknown'
  let slowestAvg = 0
  let total = 0
  let count = 0
  for (const [phase, arr] of entries) {
    const avg = arr.reduce((a, b) => a + b, 0) / arr.length
    total += avg
    count += 1
    if (avg > slowestAvg) {
      slowestAvg = avg
      slowest = phase
    }
  }
  return { avgPhaseMs: count ? Math.round(total / count) : undefined, slowestPhase: slowest }
}

export async function appendUnifiedLearningSignal(policyDir: string, signal: UnifiedLearningSignal) {
  if (!isUnifiedLearningEnabled()) return
  await fs.mkdir(policyDir, { recursive: true }).catch(() => undefined)
  const p = path.join(policyDir, SIGNAL_FILE)
  await fs.appendFile(p, `${JSON.stringify(signal)}\n`, 'utf8')
}

/** P5-a：学习信号写入后更新策略梯度，并标记因果图待刷新 */
export async function recordRouteLearningExtensions(
  policyDir: string,
  signal: UnifiedLearningSignal
) {
  if (isRoutePolicyRlEnabled()) {
    await recordPolicyRlUpdate(policyDir, signal).catch(() => undefined)
  }
  if (isRouteCausalEnabled()) {
    await touchRouteCausalDirty(policyDir).catch(() => undefined)
  }
}

export async function recordUnifiedLearningFromRun(
  policyDir: string,
  run: {
    runId: string
    sessionId?: string
    intent: string
    finalConfidence: number
    routeConfidence: number
    successScore: number
    feedbackScore?: number | null
    durationMs: number
    usedTokens: number
    usedUsd: number
    firstPassSuccess: boolean
    needsClarify: boolean
    failureCategory?: string
    policyVersion?: number
    policyCanary?: boolean
    promptCanary?: boolean
    plannerRulesCanary?: boolean
    retryCount?: number
    webSearchMode?: string
    needsWebSearch?: boolean
    searchRequested?: boolean
    searchHitCount?: number
    seedUrlCount?: number
    searchRounds?: number
    searchFailed?: boolean
    routeMatrixPass?: boolean
    orchestratorSource?: string
    orchestratorJudgeAccept?: boolean
    orchestratorReflexRetries?: number
    interactionMode?: 'chat' | 'professional'
    meta?: unknown
  }
) {
  if (!isUnifiedLearningEnabled()) return
  const phase = await phaseStatsForRun(policyDir, run.runId).catch(() => ({}))
  let compositeScore = computeCompositeScore(run)
  let implicitKind: UnifiedLearningSignal['implicitKind']
  if (isImplicitLearningEnabled() && Number(run.retryCount ?? 0) > 0) {
    const penalized = applyRetryImplicitPenalty(compositeScore, Number(run.retryCount))
    compositeScore = penalized.compositeScore
    implicitKind = penalized.implicitKind
  }
  const interactionMode = run.interactionMode ?? interactionModeFromMeta(run.meta)
  await appendUnifiedLearningSignal(policyDir, {
    ts: new Date().toISOString(),
    runId: run.runId,
    sessionId: run.sessionId,
    intent: run.intent,
    compositeScore,
    signalSource: 'run',
    implicitKind,
    finalConfidence: run.finalConfidence,
    routeConfidence: run.routeConfidence,
    successScore: run.successScore,
    feedbackScore: run.feedbackScore ?? undefined,
    durationMs: run.durationMs,
    usedTokens: run.usedTokens,
    usedUsd: run.usedUsd,
    firstPassSuccess: run.firstPassSuccess,
    needsClarify: run.needsClarify,
    failureCategory: run.failureCategory,
    policyVersion: run.policyVersion,
    policyCanary: run.policyCanary,
    promptCanary: run.promptCanary,
    plannerRulesCanary: run.plannerRulesCanary,
    webSearchMode: run.webSearchMode,
    needsWebSearch: run.needsWebSearch,
    searchRequested: run.searchRequested,
    searchHitCount: run.searchHitCount,
    seedUrlCount: run.seedUrlCount,
    searchRounds: run.searchRounds,
    searchFailed: run.searchFailed,
    routeMatrixPass: run.routeMatrixPass,
    orchestratorSource: run.orchestratorSource,
    orchestratorJudgeAccept: run.orchestratorJudgeAccept,
    orchestratorReflexRetries: run.orchestratorReflexRetries,
    interactionMode,
    ...phase
  })
  const signalForBandit: UnifiedLearningSignal = {
    ts: new Date().toISOString(),
    runId: run.runId,
    sessionId: run.sessionId,
    intent: run.intent,
    compositeScore,
    signalSource: 'run',
    implicitKind,
    finalConfidence: run.finalConfidence,
    routeConfidence: run.routeConfidence,
    successScore: run.successScore,
    feedbackScore: run.feedbackScore ?? undefined,
    durationMs: run.durationMs,
    usedTokens: run.usedTokens,
    usedUsd: run.usedUsd,
    firstPassSuccess: run.firstPassSuccess,
    needsClarify: run.needsClarify,
    failureCategory: run.failureCategory,
    policyVersion: run.policyVersion,
    policyCanary: run.policyCanary,
    promptCanary: run.promptCanary,
    plannerRulesCanary: run.plannerRulesCanary,
    routeMatrixPass: run.routeMatrixPass,
    orchestratorSource: run.orchestratorSource,
    orchestratorJudgeAccept: run.orchestratorJudgeAccept,
    orchestratorReflexRetries: run.orchestratorReflexRetries,
    ...phase
  }
  if (shouldRecordRouteBanditReward(signalForBandit)) {
    await recordBanditReward(policyDir, run.intent, compositeScore).catch(() => undefined)
  }
  await recordRouteLearningExtensions(policyDir, signalForBandit).catch(() => undefined)
}
