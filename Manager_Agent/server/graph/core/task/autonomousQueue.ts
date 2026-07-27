import fs from 'node:fs/promises'
import path from 'node:path'
import { listSessionsForUser } from './userIdentity'
import { loadUserGoals } from './userGoals'
import { loadTaskStack, sortTaskItems } from './taskStack'
import { listTaskStackSessionIds } from './proactiveLoop'
import {
  ensureAutonomousPlan,
  enqueuePlanStepJob,
  isAutonomousReplanEnabled,
  pickNextPlanStep
} from './autonomousPlan'

export type AutonomousJobStatus = 'pending' | 'running' | 'done' | 'failed'

export type AutonomousJob = {
  id: string
  sessionId: string
  userId?: string
  kind: 'user_goal' | 'task_stack' | 'plan_step'
  refId: string
  title: string
  prompt: string
  status: AutonomousJobStatus
  createdAt: string
  runAfter: string
  attempts: number
  lastError?: string
  completedAt?: string
  /** P5-b：多步自治计划 */
  planId?: string
  stepId?: string
}

const QUEUE_FILE = 'autonomous-queue.json'
const LAST_RUN_FILE = 'autonomous-last-run.json'

export function isAutonomousRunEnabled() {
  return String(process.env.MANAGER_AUTONOMOUS_RUN ?? '1').trim() !== '0'
}

function cooldownMs() {
  const n = Number(process.env.MANAGER_AUTONOMOUS_COOLDOWN_MS ?? 900_000)
  return Number.isFinite(n) && n >= 300_000 ? Math.min(3_600_000, Math.floor(n)) : 900_000
}

function maxAttempts() {
  const n = Number(process.env.MANAGER_AUTONOMOUS_MAX_ATTEMPTS ?? 2)
  return Number.isFinite(n) && n >= 1 ? Math.min(5, Math.floor(n)) : 2
}

async function readQueue(policyDir: string): Promise<AutonomousJob[]> {
  try {
    const raw = await fs.readFile(path.join(policyDir, QUEUE_FILE), 'utf8')
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? (arr as AutonomousJob[]) : []
  } catch {
    return []
  }
}

async function writeQueue(policyDir: string, jobs: AutonomousJob[]) {
  await fs.mkdir(policyDir, { recursive: true }).catch(() => undefined)
  await fs.writeFile(path.join(policyDir, QUEUE_FILE), JSON.stringify(jobs.slice(-40), null, 2), 'utf8')
}

function jobKey(kind: string, refId: string, sessionId: string) {
  return `${kind}|${refId}|${sessionId}`
}

function buildPrompt(kind: 'user_goal' | 'task_stack', title: string, note?: string) {
  const extra = note ? `\n背景：${note.slice(0, 280)}` : ''
  return `[自治推进·轻量 run] 以下事项已到期或长期未更新，请做**最小可行推进**（检索/归纳/给出下一步），勿执行高风险 admin 写操作；输出简洁结论与建议下一步。\n目标：${title}${extra}`
}

export async function enqueueAutonomousJob(
  policyDir: string,
  job: Omit<AutonomousJob, 'id' | 'status' | 'createdAt' | 'attempts'>
): Promise<AutonomousJob | null> {
  if (!isAutonomousRunEnabled()) return null
  const queue = await readQueue(policyDir)
  const key = jobKey(job.kind, job.refId, job.sessionId)
  if (queue.some((j) => jobKey(j.kind, j.refId, j.sessionId) === key && (j.status === 'pending' || j.status === 'running'))) {
    return null
  }
  const row: AutonomousJob = {
    ...job,
    id: `auto_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    status: 'pending',
    createdAt: new Date().toISOString(),
    attempts: 0
  }
  queue.push(row)
  await writeQueue(policyDir, queue)
  return row
}

export async function scanAndEnqueueAutonomousJobs(policyDir: string): Promise<{ enqueued: number }> {
  if (!isAutonomousRunEnabled()) return { enqueued: 0 }
  let enqueued = 0
  const now = Date.now()

  try {
    const dir = path.join(policyDir, 'user-goals')
    const files = await fs.readdir(dir).catch(() => [] as string[])
    for (const f of files.filter((x) => x.endsWith('.json')).slice(0, 50)) {
      const userId = f.replace(/\.json$/, '')
      const store = await loadUserGoals(policyDir, userId)
      for (const goal of store.goals) {
        if (goal.status !== 'active' || !goal.deadline) continue
        const ms = Date.parse(goal.deadline)
        if (!Number.isFinite(ms) || ms > now) continue
        const sessions = goal.linkedSessionIds.length
          ? goal.linkedSessionIds
          : await listSessionsForUser(policyDir, userId)
        const sessionId = sessions[0] || userId
        if (isAutonomousReplanEnabled()) {
          const plan = await ensureAutonomousPlan({
            policyDir,
            refKind: 'user_goal',
            refId: goal.id,
            sessionId,
            userId,
            title: goal.title,
            note: goal.note
          })
          const step = plan ? pickNextPlanStep(plan) : null
          const row = plan && step ? await enqueuePlanStepJob(policyDir, plan, step) : null
          if (row) enqueued += 1
        } else {
          const row = await enqueueAutonomousJob(policyDir, {
            sessionId,
            userId,
            kind: 'user_goal',
            refId: goal.id,
            title: goal.title,
            prompt: buildPrompt('user_goal', goal.title, goal.note),
            runAfter: new Date().toISOString()
          })
          if (row) enqueued += 1
        }
      }
    }
  } catch {}

  const sessionIds = await listTaskStackSessionIds(policyDir)
  for (const sid of sessionIds.slice(0, 30)) {
    const stack = await loadTaskStack(policyDir, sid)
    for (const task of sortTaskItems(stack.items).filter((t) => t.status === 'active' && t.priority !== 'low')) {
      if (!task.deadline) continue
      const ms = Date.parse(task.deadline)
      if (!Number.isFinite(ms) || ms > now) continue
      if (isAutonomousReplanEnabled()) {
        const plan = await ensureAutonomousPlan({
          policyDir,
          refKind: 'task_stack',
          refId: task.id,
          sessionId: sid,
          title: task.title,
          note: task.note
        })
        const step = plan ? pickNextPlanStep(plan) : null
        const row = plan && step ? await enqueuePlanStepJob(policyDir, plan, step) : null
        if (row) enqueued += 1
      } else {
        const row = await enqueueAutonomousJob(policyDir, {
          sessionId: sid,
          kind: 'task_stack',
          refId: task.id,
          title: task.title,
          prompt: buildPrompt('task_stack', task.title, task.note),
          runAfter: new Date().toISOString()
        })
        if (row) enqueued += 1
      }
    }
  }

  return { enqueued }
}

async function lastRunAt(policyDir: string): Promise<number> {
  try {
    const raw = await fs.readFile(path.join(policyDir, LAST_RUN_FILE), 'utf8')
    const o = JSON.parse(raw)
    const t = Date.parse(String(o?.ts || ''))
    return Number.isFinite(t) ? t : 0
  } catch {
    return 0
  }
}

async function touchLastRun(policyDir: string) {
  await fs.writeFile(
    path.join(policyDir, LAST_RUN_FILE),
    JSON.stringify({ ts: new Date().toISOString() }, null, 2),
    'utf8'
  )
}

export async function pickNextAutonomousJob(policyDir: string): Promise<AutonomousJob | null> {
  const queue = await readQueue(policyDir)
  const now = Date.now()
  const pending = queue
    .filter((j) => j.status === 'pending' && Date.parse(j.runAfter) <= now)
    .sort((a, b) => Date.parse(a.runAfter) - Date.parse(b.runAfter))
  return pending[0] || null
}

export async function updateAutonomousJob(
  policyDir: string,
  jobId: string,
  patch: Partial<AutonomousJob>
): Promise<void> {
  const queue = await readQueue(policyDir)
  const next = queue.map((j) => (j.id === jobId ? { ...j, ...patch } : j))
  await writeQueue(policyDir, next)
}

export async function buildAutonomousQueueDashboard(policyDir: string) {
  const queue = await readQueue(policyDir)
  const { buildAutonomousPlansDashboard } = await import('./autonomousPlan')
  const plans = await buildAutonomousPlansDashboard(policyDir).catch(() => ({
    enabled: false,
    activePlans: 0,
    recent: []
  }))
  return {
    enabled: isAutonomousRunEnabled(),
    replanEnabled: isAutonomousReplanEnabled(),
    pending: queue.filter((j) => j.status === 'pending').length,
    running: queue.filter((j) => j.status === 'running').length,
    planStepPending: queue.filter((j) => j.kind === 'plan_step' && j.status === 'pending').length,
    activePlans: plans.activePlans,
    recent: queue.slice(-8).reverse()
  }
}

export type AutonomousTickResult = {
  skipped?: string
  jobId?: string
  ok?: boolean
  error?: string
  enqueued?: number
}

export async function processAutonomousQueueTick(
  policyDir: string,
  execute: (job: AutonomousJob) => Promise<{ ok: boolean; error?: string }>
): Promise<AutonomousTickResult> {
  if (!isAutonomousRunEnabled()) return { skipped: 'disabled' }

  const enq = await scanAndEnqueueAutonomousJobs(policyDir)
  const last = await lastRunAt(policyDir)
  if (Date.now() - last < cooldownMs()) {
    return { skipped: 'cooldown', enqueued: enq.enqueued }
  }

  const job = await pickNextAutonomousJob(policyDir)
  if (!job) return { enqueued: enq.enqueued, skipped: 'empty' }

  await updateAutonomousJob(policyDir, job.id, { status: 'running', attempts: job.attempts + 1 })
  await touchLastRun(policyDir)

  try {
    const r = await execute(job)
    if (r.ok) {
      await updateAutonomousJob(policyDir, job.id, {
        status: 'done',
        completedAt: new Date().toISOString(),
        lastError: undefined
      })
      return { jobId: job.id, ok: true, enqueued: enq.enqueued }
    }
    const failed = job.attempts + 1 >= maxAttempts()
    await updateAutonomousJob(policyDir, job.id, {
      status: failed ? 'failed' : 'pending',
      lastError: r.error || 'unknown',
      runAfter: new Date(Date.now() + 600_000).toISOString()
    })
    return { jobId: job.id, ok: false, error: r.error, enqueued: enq.enqueued }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    await updateAutonomousJob(policyDir, job.id, {
      status: 'failed',
      lastError: msg,
      completedAt: new Date().toISOString()
    })
    return { jobId: job.id, ok: false, error: msg, enqueued: enq.enqueued }
  }
}
