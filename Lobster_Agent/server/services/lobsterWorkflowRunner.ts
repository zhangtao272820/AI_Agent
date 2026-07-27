/**
 * Workflow Macro 执行器：确定性 Playwright 步骤 + approve 闸门
 * 对齐 openclaw/lobster：一步调用可复现流水线，失败不静默降级为 LLM 点选（由调用方决定是否回退）
 */
import { chromium, type Page } from 'playwright'
import type { RunParams } from './lobster/types'
import { buildChromiumLaunchOptions } from '../utils/chromiumLaunch'
import { resolveEffectiveHeadless } from '../utils/lobster_env'
import { ensureLobsterGuiFinalPayload } from './lobsterGuiFinalPayload'
import {
  assertRequiredWorkflowArgs,
  loadLobsterWorkflow,
  resolveWorkflowArgs,
} from './lobsterWorkflowLoader'
import {
  interpolateWorkflowText,
  type LobsterWorkflowDef,
  type LobsterWorkflowStep,
} from './lobsterWorkflowSchema'

function emitLog(params: RunParams, level: 'info' | 'warn' | 'error', message: string) {
  params.emit({
    type: 'log',
    payload: { level, message: String(message || '').slice(0, 2000), ts: Date.now() },
  })
}

function autoApproveEnabled(): boolean {
  return String(process.env.LOBSTER_WORKFLOW_AUTO_APPROVE ?? '0').trim() === '1'
}

async function runStep(input: {
  page: Page
  step: LobsterWorkflowStep
  vars: Record<string, string>
  params: RunParams
  stepIndex: number
}): Promise<{ done?: boolean; answer?: string }> {
  const { page, step, vars, params, stepIndex } = input
  const label = `wf[${stepIndex + 1}/${step.action}]`

  if (step.action === 'goto') {
    const url = interpolateWorkflowText(step.url, vars)
    emitLog(params, 'info', `${label} goto ${url}`)
    await page.goto(url, {
      waitUntil: step.waitUntil || 'domcontentloaded',
      timeout: 60_000,
    })
    vars.pageUrl = page.url()
    return {}
  }

  if (step.action === 'snapshot') {
    const title = await page.title().catch(() => '')
    const url = page.url()
    vars.pageTitle = title
    vars.pageUrl = url
    if (step.assignTo) vars[step.assignTo] = `${title} | ${url}`
    emitLog(params, 'info', `${label} title=${title.slice(0, 80)}`)
    params.emit({
      type: 'state',
      payload: {
        phase: 'workflow_snapshot',
        stepCount: stepIndex + 1,
        pageUrl: url,
        pageTitle: title,
        ts: Date.now(),
      } as any,
    })
    return {}
  }

  if (step.action === 'click') {
    const sel = interpolateWorkflowText(step.selector, vars)
    emitLog(params, 'info', `${label} click ${sel}`)
    await page.click(sel, { timeout: step.timeoutMs || 15_000 })
    return {}
  }

  if (step.action === 'type') {
    const sel = interpolateWorkflowText(step.selector, vars)
    const text = interpolateWorkflowText(step.text, vars)
    emitLog(params, 'info', `${label} type ${sel}`)
    if (step.clear !== false) await page.fill(sel, text, { timeout: step.timeoutMs || 15_000 })
    else await page.type(sel, text, { timeout: step.timeoutMs || 15_000 })
    return {}
  }

  if (step.action === 'extract') {
    const sel = step.selector ? interpolateWorkflowText(step.selector, vars) : 'body'
    let value = ''
    if (step.attr) {
      value = String((await page.getAttribute(sel, step.attr).catch(() => '')) || '')
    } else {
      value = String((await page.locator(sel).first().innerText().catch(() => '')) || '').trim()
    }
    vars[step.assignTo] = value
    emitLog(params, 'info', `${label} extract ${step.assignTo}=${value.slice(0, 120)}`)
    return {}
  }

  if (step.action === 'wait') {
    emitLog(params, 'info', `${label} wait ${step.ms}ms`)
    await page.waitForTimeout(step.ms)
    return {}
  }

  if (step.action === 'approve') {
    const title = interpolateWorkflowText(step.title, vars)
    const message = interpolateWorkflowText(step.message, vars)
    emitLog(params, 'info', `${label} approve: ${title}`)
    if (autoApproveEnabled()) {
      emitLog(params, 'warn', `${label} LOBSTER_WORKFLOW_AUTO_APPROVE=1 · 已自动通过`)
      return {}
    }
    if (!params.human?.waitConfirm) {
      throw new Error('lobster_workflow_approve_requires_human')
    }
    const id = `wf_approve_${stepIndex}_${Date.now()}`
    params.emit({
      type: 'confirm',
      payload: { id, title, message, ts: Date.now() },
    })
    const ok = await params.human.waitConfirm(id, params.signal)
    if (!ok) throw new Error('lobster_workflow_approve_denied')
    return {}
  }

  if (step.action === 'finish') {
    const answer = interpolateWorkflowText(step.answer, vars)
    return { done: true, answer }
  }

  return {}
}

function emitWorkflowInsight(params: RunParams, workflowId: string) {
  const ts = Date.now()
  params.emit({
    type: 'engine_chain',
    payload: {
      ts,
      chain: ['workflow'],
      activeIndex: 0,
      workflowId,
      picked: {
        engine: 'workflow',
        source: 'workflow_id',
        confidence: 1,
        reason: `workflow_id=${workflowId}`,
      },
    },
  })
  params.emit({
    type: 'engine_active',
    payload: {
      ts,
      engine: 'workflow',
      actualEngine: 'workflow',
      attemptIndex: 0,
      workflowId,
    },
  })
  params.emit({
    type: 'run_meta',
    payload: {
      ts,
      runId: params.runId,
      actualEngine: 'workflow',
      engine: 'workflow',
      workflowId,
      storageProfile: params.storageProfile,
    },
  })
}

export async function runLobsterWorkflowAgent(params: RunParams & { workflowId: string }) {
  const workflowId = String(params.workflowId || '').trim()
  const def: LobsterWorkflowDef = loadLobsterWorkflow(workflowId)
  const vars = resolveWorkflowArgs(def, params.workflowArgs || null, {
    task: params.task,
    startUrl: String(params.startUrl || ''),
  })
  if (params.startUrl && !vars.startUrl) vars.startUrl = params.startUrl
  assertRequiredWorkflowArgs(def, vars)

  emitWorkflowInsight(params, def.id)
  emitLog(params, 'info', `Workflow Macro：${def.id} · ${def.name} · ${def.steps.length} 步`)

  const configHeadless = params.config?.lobster?.headless !== false
  const headless = resolveEffectiveHeadless(configHeadless)
  const launch = buildChromiumLaunchOptions(headless)
  const browser = await chromium.launch({
    headless,
    args: launch.args,
    env: launch.env,
  })

  let finalAnswer = ''
  let finalUrl = ''
  let pageTitle = ''
  const stepLog: Array<{ i: number; action: string; ok: boolean; detail?: string }> = []

  try {
    const context = await browser.newContext()
    const page = await context.newPage()
    if (vars.startUrl && !def.steps.some((s) => s.action === 'goto')) {
      await page.goto(vars.startUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    }

    for (let i = 0; i < def.steps.length; i++) {
      if (params.signal.aborted) throw new Error('canceled')
      await params.human?.waitWhilePaused?.(params.signal)
      const step = def.steps[i]
      try {
        const r = await runStep({ page, step, vars, params, stepIndex: i })
        stepLog.push({ i, action: step.action, ok: true })
        if (r.done) {
          finalAnswer = String(r.answer || '').trim()
          break
        }
      } catch (e: any) {
        const msg = e?.message ? String(e.message) : String(e)
        stepLog.push({ i, action: step.action, ok: false, detail: msg.slice(0, 300) })
        throw e
      }
    }

    finalUrl = page.url()
    pageTitle = await page.title().catch(() => '')
    if (!finalAnswer) {
      finalAnswer = `工作流 ${def.id} 已执行 ${stepLog.filter((s) => s.ok).length}/${def.steps.length} 步`
      if (pageTitle) finalAnswer += `\n标题：${pageTitle}`
      if (finalUrl) finalAnswer += `\n链接：${finalUrl}`
    }

    const raw = ensureLobsterGuiFinalPayload(
      {
        ok: true,
        engine: 'workflow',
        actualEngine: 'workflow',
        workflowId: def.id,
        answer: finalAnswer,
        finalUrl,
        pageTitle,
        data: [{ items: [{ workflow: def.id, steps: stepLog }] }],
      },
      params.task,
    )

    return raw
  } finally {
    await browser.close().catch(() => {})
  }
}

export function isLobsterWorkflowId(raw: unknown): boolean {
  const s = String(raw || '').trim()
  return /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(s)
}
