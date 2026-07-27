import fs from 'node:fs/promises'
import path from 'node:path'
import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import type { AutonomousJob } from './autonomousQueue'
import { enqueueAutonomousJob, isAutonomousRunEnabled } from './autonomousQueue'
import { setUserGoalStatus, isUserGoalsEnabled } from './userGoals'
import { loadTaskStack, saveTaskStack } from './taskStack'

export type PlanStepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped'

export type AutonomousPlanStep = {
  id: string
  title: string
  prompt: string
  status: PlanStepStatus
  order: number
  lastRunAt?: string
  lastSummary?: string
}

export type AutonomousPlan = {
  id: string
  refKind: 'user_goal' | 'task_stack'
  refId: string
  sessionId: string
  userId?: string
  goalTitle: string
  goalNote?: string
  status: 'active' | 'completed' | 'paused'
  steps: AutonomousPlanStep[]
  replanCount: number
  version: number
  createdAt: string
  updatedAt: string
}

const PLANS_DIR = 'autonomous-plans'

export function isAutonomousReplanEnabled() {
  return (
    isAutonomousRunEnabled() &&
    String(process.env.MANAGER_AUTONOMOUS_REPLAN ?? '1').trim() !== '0'
  )
}

export function isAutonomousDecomposeEnabled() {
  return (
    isAutonomousReplanEnabled() &&
    String(process.env.MANAGER_AUTONOMOUS_DECOMPOSE ?? '1').trim() !== '0'
  )
}

function maxStepsPerPlan() {
  const n = Number(process.env.MANAGER_AUTONOMOUS_MAX_STEPS ?? 8)
  return Number.isFinite(n) && n >= 3 ? Math.min(12, Math.floor(n)) : 8
}

function replanMinIntervalMs() {
  const n = Number(process.env.MANAGER_AUTONOMOUS_REPLAN_MIN_MS ?? 120_000)
  return Number.isFinite(n) && n >= 30_000 ? Math.min(3_600_000, Math.floor(n)) : 120_000
}

function nowIso() {
  return new Date().toISOString()
}

function planIdFor(refKind: string, refId: string) {
  return `plan_${refKind}_${refId}`.replace(/[^a-zA-Z0-9_|.-]/g, '_').slice(0, 120)
}

function plansDir(policyDir: string) {
  return path.join(policyDir, PLANS_DIR)
}

function planPath(policyDir: string, planId: string) {
  return path.join(plansDir(policyDir), `${planId}.json`)
}

function safeJsonArray(text: string): unknown[] {
  const s = String(text || '').trim()
  const m = s.match(/\[[\s\S]*\]/)
  if (!m) return []
  try {
    const arr = JSON.parse(m[0])
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function ruleBasedSteps(title: string, note?: string): AutonomousPlanStep[] {
  const ctx = note ? `\n背景：${note.slice(0, 240)}` : ''
  return [
    {
      id: 'step_1',
      title: '现状梳理',
      order: 1,
      status: 'pending',
      prompt: `[自治推进·步骤1/多步] 目标「${title}」：梳理现状、检索/归纳已有信息，列出关键事实与缺口。勿 admin 写操作。${ctx}`
    },
    {
      id: 'step_2',
      title: '分析与方案',
      order: 2,
      status: 'pending',
      prompt: `[自治推进·步骤2/多步] 目标「${title}」：基于上一步结论，给出可行方案与风险点（简洁）。勿 admin 写操作。${ctx}`
    },
    {
      id: 'step_3',
      title: '下一步清单',
      order: 3,
      status: 'pending',
      prompt: `[自治推进·步骤3/多步] 目标「${title}」：输出可执行下一步清单（≤5条，含优先级）。若目标已达成则说明「目标已达成」及依据。勿 admin 写操作。${ctx}`
    }
  ]
}

async function llmDecomposeSteps(title: string, note?: string): Promise<AutonomousPlanStep[] | null> {
  if (!isAutonomousDecomposeEnabled()) return null
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim()
  const baseUrl = String(process.env.OPENAI_BASE_URL || '').trim()
  const model = String(process.env.MANAGER_MODEL_PLAN || process.env.OPENAI_MODEL || '').trim()
  if (!apiKey || !baseUrl || !model) return null

  const llm = new ChatOpenAI({
    apiKey,
    configuration: { baseURL: baseUrl },
    model,
    temperature: 0.2,
    maxTokens: 900
  })

  const res = await llm.invoke([
    new SystemMessage(
      [
        '你是自治目标分解器。将用户长期目标拆成 3～6 个可顺序执行的自治步骤（后台 headless，无人工确认）。',
        '约束：禁止 admin 写操作（创建待办/发邮件/改日程）；每步应可检索/归纳/给建议。',
        '只输出 JSON 数组：[{ "title": "...", "prompt": "..." }, ...]，不要其它文字。'
      ].join('\n')
    ),
    new HumanMessage(`目标：${title}\n说明：${note || '无'}`)
  ])

  const arr = safeJsonArray(String(res.content || ''))
  const steps: AutonomousPlanStep[] = []
  let order = 1
  for (const raw of arr.slice(0, maxStepsPerPlan())) {
    if (!raw || typeof raw !== 'object') continue
    const o = raw as Record<string, unknown>
    const t = String(o.title || '').trim()
    const p = String(o.prompt || '').trim()
    if (!t || !p) continue
    steps.push({
      id: `step_${order}`,
      title: t.slice(0, 120),
      prompt: `[自治推进·步骤${order}] ${p.slice(0, 1200)}`,
      status: 'pending',
      order
    })
    order += 1
  }
  return steps.length >= 2 ? steps : null
}

export async function loadAutonomousPlan(
  policyDir: string,
  planId: string
): Promise<AutonomousPlan | null> {
  try {
    const raw = await fs.readFile(planPath(policyDir, planId), 'utf8')
    return JSON.parse(raw) as AutonomousPlan
  } catch {
    return null
  }
}

async function saveAutonomousPlan(policyDir: string, plan: AutonomousPlan) {
  await fs.mkdir(plansDir(policyDir), { recursive: true }).catch(() => undefined)
  await fs.writeFile(
    planPath(policyDir, plan.id),
    JSON.stringify({ ...plan, updatedAt: nowIso() }, null, 2),
    'utf8'
  )
}

export async function ensureAutonomousPlan(input: {
  policyDir: string
  refKind: 'user_goal' | 'task_stack'
  refId: string
  sessionId: string
  userId?: string
  title: string
  note?: string
}): Promise<AutonomousPlan | null> {
  if (!isAutonomousReplanEnabled()) return null
  const id = planIdFor(input.refKind, input.refId)
  const existing = await loadAutonomousPlan(input.policyDir, id)
  if (existing && existing.status === 'active' && existing.steps.some((s) => s.status === 'pending')) {
    return existing
  }
  if (existing?.status === 'completed') return existing

  const llmSteps = await llmDecomposeSteps(input.title, input.note).catch(() => null)
  const steps = llmSteps || ruleBasedSteps(input.title, input.note)
  const plan: AutonomousPlan = {
    id,
    refKind: input.refKind,
    refId: input.refId,
    sessionId: input.sessionId,
    userId: input.userId,
    goalTitle: input.title,
    goalNote: input.note,
    status: 'active',
    steps,
    replanCount: 0,
    version: 1,
    createdAt: nowIso(),
    updatedAt: nowIso()
  }
  await saveAutonomousPlan(input.policyDir, plan)
  return plan
}

export function pickNextPlanStep(plan: AutonomousPlan): AutonomousPlanStep | null {
  const pending = plan.steps
    .filter((s) => s.status === 'pending')
    .sort((a, b) => a.order - b.order)
  return pending[0] || null
}

export function buildPlanStepPrompt(plan: AutonomousPlan, step: AutonomousPlanStep): string {
  const done = plan.steps
    .filter((s) => s.status === 'done' && s.lastSummary)
    .sort((a, b) => a.order - b.order)
    .slice(-3)
  const recap =
    done.length > 0
      ? `\n\n【已完成步骤摘要】\n${done.map((s) => `- ${s.title}：${s.lastSummary}`).join('\n')}`
      : ''
  return `${step.prompt}${recap}\n\n（总目标：${plan.goalTitle}；当前步骤 ${step.order}/${plan.steps.length}）`
}

export async function enqueuePlanStepJob(
  policyDir: string,
  plan: AutonomousPlan,
  step: AutonomousPlanStep
): Promise<AutonomousJob | null> {
  const prompt = buildPlanStepPrompt(plan, step)
  return enqueueAutonomousJob(policyDir, {
    sessionId: plan.sessionId,
    userId: plan.userId,
    kind: 'plan_step',
    refId: `${plan.refId}|${step.id}`,
    title: `${plan.goalTitle} · ${step.title}`,
    prompt,
    runAfter: new Date().toISOString(),
    planId: plan.id,
    stepId: step.id
  })
}

const GOAL_COMPLETE_MARKERS = ['目标已达成', '任务已完成', '无需继续推进', '已全部完成', '可以结案'] as const

function looksGoalComplete(text: string): boolean {
  const t = String(text ?? '')
  return GOAL_COMPLETE_MARKERS.some((m) => t.includes(m))
}

function summarizeForPlan(text: string, max = 400): string {
  const t = String(text || '')
    .replace(/【自治推进[^】]*】/g, '')
    .trim()
  return t.length > max ? `${t.slice(0, max)}…` : t
}

async function llmReplanSteps(
  plan: AutonomousPlan,
  lastOutput: string
): Promise<{ steps?: AutonomousPlanStep[]; markComplete?: boolean; reason?: string } | null> {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim()
  const baseUrl = String(process.env.OPENAI_BASE_URL || '').trim()
  const model = String(process.env.MANAGER_MODEL_PLAN || process.env.OPENAI_MODEL || '').trim()
  if (!apiKey || !baseUrl || !model) return null

  const llm = new ChatOpenAI({
    apiKey,
    configuration: { baseURL: baseUrl },
    model,
    temperature: 0.15,
    maxTokens: 1000
  })

  const stepLines = plan.steps
    .map((s) => `- [${s.status}] ${s.id} ${s.title}${s.lastSummary ? `：${s.lastSummary.slice(0, 120)}` : ''}`)
    .join('\n')

  const res = await llm.invoke([
    new SystemMessage(
      [
        '你是自治 replan 官。根据目标、步骤状态与最新输出，决定是否已完成目标，并调整剩余步骤。',
        '只输出严格 JSON：',
        '{ "markComplete": boolean, "reason": "...", "remainingSteps": [{ "title":"", "prompt":"" }] }',
        'remainingSteps 仅包含仍待执行的步骤（可改写/新增，≤4条）；markComplete=true 时 remainingSteps 可为 []。',
        '禁止 admin 写操作。'
      ].join('\n')
    ),
    new HumanMessage(
      `目标：${plan.goalTitle}\n说明：${plan.goalNote || ''}\n步骤：\n${stepLines}\n\n最新输出：\n${lastOutput.slice(0, 2500)}`
    )
  ])

  try {
    const m = String(res.content || '').match(/\{[\s\S]*\}/)
    if (!m) return null
    const o = JSON.parse(m[0]) as Record<string, unknown>
    const markComplete = Boolean(o.markComplete)
    const remaining = Array.isArray(o.remainingSteps) ? o.remainingSteps : []
    const steps: AutonomousPlanStep[] = []
    let order =
      Math.max(0, ...plan.steps.filter((s) => s.status === 'done').map((s) => s.order)) + 1
    for (const raw of remaining.slice(0, maxStepsPerPlan())) {
      if (!raw || typeof raw !== 'object') continue
      const row = raw as Record<string, unknown>
      const title = String(row.title || '').trim()
      const prompt = String(row.prompt || '').trim()
      if (!title || !prompt) continue
      steps.push({
        id: `step_re_${order}`,
        title: title.slice(0, 120),
        prompt: `[自治推进·replan] ${prompt.slice(0, 1200)}`,
        status: 'pending',
        order
      })
      order += 1
    }
    return {
      markComplete,
      reason: String(o.reason || '').slice(0, 300),
      steps: steps.length ? steps : undefined
    }
  } catch {
    return null
  }
}

async function markRefComplete(policyDir: string, plan: AutonomousPlan) {
  if (plan.refKind === 'user_goal' && plan.userId && isUserGoalsEnabled()) {
    await setUserGoalStatus(policyDir, plan.userId, plan.refId, 'done').catch(() => undefined)
  }
  if (plan.refKind === 'task_stack') {
    const stack = await loadTaskStack(policyDir, plan.sessionId).catch(() => null)
    if (stack) {
      const items = stack.items.map((t) =>
        t.id === plan.refId ? { ...t, status: 'done' as const, updatedAt: nowIso() } : t
      )
      await saveTaskStack(policyDir, { ...stack, items }).catch(() => undefined)
    }
  }
}

export async function handleAutonomousRunComplete(
  policyDir: string,
  job: AutonomousJob,
  result: { ok: boolean; finalText?: string; error?: string }
): Promise<{ planCompleted?: boolean; nextStepEnqueued?: boolean }> {
  if (!isAutonomousReplanEnabled() || !job.planId || !job.stepId) {
    return {}
  }

  const plan = await loadAutonomousPlan(policyDir, job.planId)
  if (!plan || plan.status !== 'active') return {}

  const summary = result.ok
    ? summarizeForPlan(result.finalText || '')
    : `失败：${String(result.error || 'unknown').slice(0, 200)}`

  const steps = plan.steps.map((s) => {
    if (s.id !== job.stepId) return s
    return {
      ...s,
      status: result.ok ? ('done' as const) : ('failed' as const),
      lastRunAt: nowIso(),
      lastSummary: summary
    }
  })

  let nextPlan: AutonomousPlan = { ...plan, steps, updatedAt: nowIso() }

  const lastOk = result.ok && result.finalText
  const canReplan =
    lastOk &&
    plan.replanCount < 6 &&
    Date.now() - Date.parse(plan.updatedAt || '0') >= replanMinIntervalMs()

  if (canReplan) {
    const replan = await llmReplanSteps(nextPlan, result.finalText!).catch(() => null)
    if (replan?.markComplete || looksGoalComplete(result.finalText!)) {
      nextPlan = { ...nextPlan, status: 'completed', replanCount: plan.replanCount + 1 }
      await saveAutonomousPlan(policyDir, nextPlan)
      await markRefComplete(policyDir, nextPlan)
      return { planCompleted: true }
    }
    if (replan?.steps?.length) {
      const doneIds = new Set(nextPlan.steps.filter((s) => s.status === 'done').map((s) => s.id))
      const merged = [
        ...nextPlan.steps.filter((s) => doneIds.has(s.id)),
        ...replan.steps.filter((s) => s.status === 'pending')
      ]
      nextPlan = {
        ...nextPlan,
        steps: merged,
        version: plan.version + 1,
        replanCount: plan.replanCount + 1
      }
    } else {
      nextPlan = { ...nextPlan, replanCount: plan.replanCount + 1 }
    }
  } else if (lastOk && looksGoalComplete(result.finalText!)) {
    nextPlan = { ...nextPlan, status: 'completed' }
    await markRefComplete(policyDir, nextPlan)
    await saveAutonomousPlan(policyDir, nextPlan)
    return { planCompleted: true }
  }

  await saveAutonomousPlan(policyDir, nextPlan)

  const nextStep = pickNextPlanStep(nextPlan)
  if (!nextStep || nextPlan.status === 'completed') {
    if (!nextStep && nextPlan.steps.every((s) => s.status === 'done' || s.status === 'skipped')) {
      nextPlan = { ...nextPlan, status: 'completed' }
      await saveAutonomousPlan(policyDir, nextPlan)
      await markRefComplete(policyDir, nextPlan)
      return { planCompleted: true }
    }
    return {}
  }

  const enqueued = await enqueuePlanStepJob(policyDir, nextPlan, nextStep)
  return { nextStepEnqueued: Boolean(enqueued) }
}

export async function buildAutonomousPlansDashboard(policyDir: string, sessionId?: string) {
  if (!isAutonomousReplanEnabled()) {
    return { enabled: false, activePlans: 0, recent: [] as AutonomousPlan[] }
  }
  let files: string[] = []
  try {
    files = await fs.readdir(plansDir(policyDir))
  } catch {
    return { enabled: true, activePlans: 0, recent: [] }
  }
  const plans: AutonomousPlan[] = []
  for (const f of files.filter((x) => x.endsWith('.json')).slice(-30)) {
    try {
      const raw = await fs.readFile(path.join(plansDir(policyDir), f), 'utf8')
      const p = JSON.parse(raw) as AutonomousPlan
      if (sessionId && p.sessionId !== sessionId) continue
      plans.push(p)
    } catch {}
  }
  const active = plans.filter((p) => p.status === 'active')
  return {
    enabled: true,
    activePlans: active.length,
    recent: plans.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 6)
  }
}
