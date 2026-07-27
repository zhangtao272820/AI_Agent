import type { Step } from '../../../utils/shared/taskPlan'

export type StepRunStatus = 'ok' | 'error' | 'skipped'

export type StepRunRecord = {
  id: string
  agent: Step['agent']
  query: string
  output: string
  status: StepRunStatus
  error?: string
  parsed?: unknown
  /** code 等 Agent 附带的结构化 meta */
  meta?: unknown
  /** A2：专才结构化交接（父上下文优先用 summary） */
  handoff?: import('../../../utils/agents/types').SpecialistHandoff
}

export type AgentRunTelemetry = {
  scaledTimeoutForAgent: (agent: string, baseMs: number) => number
  recordAgentSuccess: (agent: string) => void
  recordAgentFailure: (agent: string) => void
  getAgentFailureStreak: (agent: string) => number
  optionalAgents: Set<string>
  runtimeCircuitOpenAgents: Set<string>
  circuitStreakThreshold: number
}

export type CreateAgentRunTelemetryInput = {
  globalTimeoutMs: number
  timeLeftMs: () => number
  schedulerTimeoutScale?: number
  schedulerAgentTimeoutScale?: Record<string, number>
  toolHealthP95ByAgent?: Map<string, number>
  schedulerCircuitOpenAgents?: string[]
}

const DEFAULT_OPTIONAL_AGENTS = new Set(['clean', 'visualize', 'report'])

/** 同 Agent 连续失败达阈后开路（clamp 1–5，默认 2） */
export function readAgentCircuitStreak(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.MANAGER_AGENT_CIRCUIT_STREAK ?? 2)
  if (!Number.isFinite(n)) return 2
  return Math.max(1, Math.min(5, Math.floor(n)))
}

/** 熔断后是否跳过核心 Agent（默认开） */
export function isCircuitSkipCoreEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.MANAGER_CIRCUIT_SKIP_CORE ?? '1').trim() !== '0'
}

/** 多步执行共享：超时缩放、熔断计数、可选 Agent 集合 */
export function createAgentRunTelemetry(input: CreateAgentRunTelemetryInput): AgentRunTelemetry {
  const globalTimeoutMs = Math.max(60_000, Number(input.globalTimeoutMs) || 60_000)
  const maxStepTimeoutMs = Math.min(300_000, Math.max(120_000, globalTimeoutMs * 2))
  const timeoutScale = Number.isFinite(input.schedulerTimeoutScale)
    ? Math.max(0.8, Math.min(1.8, input.schedulerTimeoutScale!))
    : 1
  const circuitStreakThreshold = readAgentCircuitStreak()
  const agentFailureStreak = new Map<string, number>()
  const runtimeCircuitOpenAgents = new Set<string>(input.schedulerCircuitOpenAgents ?? [])

  const scaledTimeoutForAgent = (agent: string, baseMs: number) => {
    const perAgent = Number(input.schedulerAgentTimeoutScale?.[agent] ?? 1)
    const per = Number.isFinite(perAgent) ? Math.max(0.8, Math.min(1.9, perAgent)) : 1
    const scaled = Math.round(baseMs * timeoutScale * per)
    const p95 = input.toolHealthP95ByAgent?.get(agent) || 0
    const p95Floor = p95 >= 8_000 ? Math.round(p95 * 1.2 + 5_000) : 0
    const leftMs = input.timeLeftMs()
    const budgetCap = leftMs > 8_000 ? leftMs - 4_000 : maxStepTimeoutMs
    return Math.max(12_000, Math.min(maxStepTimeoutMs, budgetCap, Math.max(scaled, p95Floor)))
  }

  const recordAgentSuccess = (agent: string) => {
    if (!agent) return
    agentFailureStreak.set(agent, 0)
  }

  const recordAgentFailure = (agent: string) => {
    if (!agent) return
    const next = Number(agentFailureStreak.get(agent) || 0) + 1
    agentFailureStreak.set(agent, next)
    if (next >= circuitStreakThreshold) runtimeCircuitOpenAgents.add(agent)
  }

  const getAgentFailureStreak = (agent: string) => Number(agentFailureStreak.get(agent) || 0) || 0

  return {
    scaledTimeoutForAgent,
    recordAgentSuccess,
    recordAgentFailure,
    getAgentFailureStreak,
    optionalAgents: DEFAULT_OPTIONAL_AGENTS,
    runtimeCircuitOpenAgents,
    circuitStreakThreshold
  }
}

export type StepPrecheckInput = {
  stepAgent: string
  stepId: string
  agent: Step['agent']
  effQuery: string
  /** 该 agent 是否在本轮任务计划 steps 中显式出现 */
  plannedInTask?: boolean
  schedulerSkipAgents: string[]
  schedulerDegradeOptionalAgents: string[]
  telemetry: AgentRunTelemetry
}

export type StepPrecheckPolicy = 'circuit_degrade_optional' | 'circuit_open_core' | 'tool_health_down'

export type StepPrecheckResult =
  | { action: 'run' }
  | { action: 'skip'; reason: string; policy: StepPrecheckPolicy }

/** 执行前检查：熔断降级 / 核心熔断跳过 / toolHealth 跳过 */
export function precheckAgentStep(input: StepPrecheckInput): StepPrecheckResult {
  const { stepAgent, telemetry, schedulerSkipAgents, schedulerDegradeOptionalAgents, plannedInTask } = input
  const protectPlannedOptional = Boolean(plannedInTask) && telemetry.optionalAgents.has(stepAgent)
  const circuitOpen = telemetry.runtimeCircuitOpenAgents.has(stepAgent)

  const shouldDegradeOptional =
    !protectPlannedOptional &&
    telemetry.optionalAgents.has(stepAgent) &&
    (circuitOpen || schedulerDegradeOptionalAgents.includes(stepAgent))
  if (shouldDegradeOptional) {
    return {
      action: 'skip',
      reason: `agent ${stepAgent} 熔断降级：当前跳过可选步骤以保核心链路`,
      policy: 'circuit_degrade_optional'
    }
  }

  // 核心 Agent 连败熔断：跳过同 run 后续调用，避免 local replan 反复加回空转
  if (circuitOpen && !telemetry.optionalAgents.has(stepAgent) && isCircuitSkipCoreEnabled()) {
    return {
      action: 'skip',
      reason: `agent ${stepAgent} 已熔断（连续失败≥${telemetry.circuitStreakThreshold}）：跳过以免空转耗 token`,
      policy: 'circuit_open_core'
    }
  }

  if (schedulerSkipAgents.includes(stepAgent)) {
    return {
      action: 'skip',
      reason: `agent ${stepAgent} 当前不可用（toolHealth=down），已跳过执行`,
      policy: 'tool_health_down'
    }
  }
  return { action: 'run' }
}

export type RecordSkippedStepInput = {
  stepId: string
  agent: Step['agent']
  effQuery: string
  reason: string
  policy: StepPrecheckResult extends { action: 'skip' } ? StepPrecheckResult['policy'] : string
  t0: number
  runId: string
  byId: Record<string, StepRunRecord>
  evidences: Array<Record<string, unknown>>
  relayThinking: (agent: string, text: string) => void
  emitTrace: (entry: Record<string, unknown>) => void
  appendMetrics: (entry: Record<string, unknown>) => Promise<unknown>
}

/** 写入 skipped 步骤记录并打点 */
export async function recordSkippedAgentStep(input: RecordSkippedStepInput) {
  const { stepId, agent, effQuery, reason, policy, t0, runId, byId, evidences, relayThinking, emitTrace, appendMetrics } =
    input
  byId[stepId] = { id: stepId, agent, query: effQuery, output: reason, status: 'skipped', error: reason }
  evidences.push({ kind: 'skipped', stepId, agent, query: effQuery, reason })
  const skipLabel = policy === 'tool_health_down' || policy === 'circuit_open_core' ? '跳过' : '降级跳过'
  relayThinking('manager', `步骤 ${stepId} ${skipLabel}：${reason}`)
  emitTrace({ type: 'step_skip', agent, stepId, reason, at: new Date().toISOString() })
  await appendMetrics({
    runId,
    phase: 'step_skip',
    ms: Date.now() - t0,
    extra: { stepId, agent: String(agent), reason, policy }
  })
}
