import crypto from 'node:crypto'
import { Stagehand } from '@browserbasehq/stagehand'
import { z } from 'zod'
import { sanitize } from './lobster/text'
import type { RunParams } from './lobster/types'
import { wrapLobsterOutput } from './lobsterResultEnvelope'
import {
  persistCookiesStorage,
  readStorageStateFile,
  resolveRunStoragePaths,
  stagehandCookiesFromStorage
} from './sessionStorageBridge'
import { stagehandHintsForPrompt, recipeActTemplate, isRecipeComplexPage } from './siteRecipes'
import { isStagehandEnabled, resolveEffectiveHeadless, resolveStagehandModelName } from '../utils/lobster_env'
import { resolveBrowserCdpUrl } from './browserProfiles'
import { buildChromiumLaunchOptions } from '../utils/chromiumLaunch'

const RISKY_TASK_PATTERN =
  /(支付|下单|购买|删除|注销|上传|投稿|checkout|pay\b|delete|remove|upload|purchase)/i

export async function probeStagehandReady(): Promise<{ ok: boolean; error?: string }> {
  if (!isStagehandEnabled()) return { ok: false, error: 'disabled' }
  try {
    if (!Stagehand) return { ok: false, error: 'import_failed' }
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message ? String(e.message) : String(e) }
  }
}

export async function runLobsterStagehandAgent(params: RunParams) {
  if (!isStagehandEnabled()) throw new Error('lobster_stagehand_disabled')

  const traceId = String(params.runId || crypto.randomUUID()).trim()
  const startedAt = Date.now()
  let confirmCount = 0
  let stepCount = 0

  const emitLog = (level: 'info' | 'warn' | 'error', message: string) => {
    params.emit({ type: 'log', payload: { level, message: sanitize(message), ts: Date.now() } })
  }
  const emitThinking = (stage: string, text: string) => {
    const s = sanitize(String(text || '').trim())
    if (!s) return
    params.emit({ type: 'thinking', payload: { stage, text: s, ts: Date.now() } })
  }

  const requestConfirm = async (title: string, message: string) => {
    if (!params.human) return false
    const id = crypto.randomUUID()
    params.emit({ type: 'confirm', payload: { id, title: sanitize(title), message: sanitize(message), ts: Date.now() } })
    const ok = await params.human.waitConfirm(id, params.signal)
    if (ok) confirmCount++
    return ok
  }

  const apiKey = String(params.config?.openaiApiKey || process.env.OPENAI_API_KEY || '').trim()
  const baseURL = String(params.config?.openaiBaseUrl || process.env.OPENAI_BASE_URL || '').trim()
  const modelName = resolveStagehandModelName(params.config)
  if (!apiKey) throw new Error('lobster_stagehand_llm_missing')

  const configuredHeadless = Boolean(params.config?.lobster?.headless ?? true)
  const headless = resolveEffectiveHeadless(configuredHeadless)
  if (!configuredHeadless && headless) {
    emitLog('warn', 'Stagehand：DISPLAY/Xvfb 不可用，已改用 headless 启动浏览器')
  }
  const cdpUrl = resolveBrowserCdpUrl()
  const browserLaunch = buildChromiumLaunchOptions(headless)
  const storage = await resolveRunStoragePaths({
    startUrl: params.startUrl,
    sessionId: params.sessionId,
    storageProfile: params.storageProfile,
    storageDir: String(params.config?.lobster?.storageDir || '').trim() || undefined
  })
  const loadedState = storage.loadPath ? await readStorageStateFile(storage.loadPath) : null

  const stagehand = new Stagehand({
    env: 'LOCAL',
    disablePino: true,
    verbose: 0,
    model: {
      modelName,
      apiKey,
      ...(baseURL ? { baseURL } : {})
    },
    localBrowserLaunchOptions: {
      headless,
      ignoreHTTPSErrors: true,
      viewport: { width: 1280, height: 720 },
      args: browserLaunch.args,
      env: browserLaunch.env,
      ...(cdpUrl ? { cdpUrl } : {})
    },
    logger: (line) => {
      const msg = String((line as any)?.message || line || '').trim()
      if (msg) emitLog('info', `[stagehand] ${msg.slice(0, 500)}`)
    }
  })

  try {
    emitLog('info', 'Stagehand：初始化本地浏览器…')
    params.emit({ type: 'state', payload: { phase: 'stagehand_init', stepCount: 0, pageUrl: params.startUrl || '' } })
    await stagehand.init()
    stepCount++

    if (loadedState) {
      const cookies = stagehandCookiesFromStorage(loadedState)
      if (cookies.length) {
        try {
          await stagehand.context.addCookies(cookies as any)
          emitLog('info', `Stagehand：已加载 ${cookies.length} 条 cookie（storage profile）`)
        } catch (e: any) {
          emitLog('warn', `Stagehand：加载 cookie 失败：${e?.message || e}`)
        }
      }
    }

    if (params.startUrl) {
      emitThinking('stagehand', `导航到 ${params.startUrl}`)
      try {
        await stagehand.act(`打开页面 ${params.startUrl}`)
        stepCount++
      } catch (e: any) {
        emitLog('warn', `Stagehand 导航失败：${e?.message || e}`)
      }
    }

    if (RISKY_TASK_PATTERN.test(params.task)) {
      const ok = await requestConfirm('高风险浏览器任务', 'Stagehand 任务可能涉及敏感操作，是否继续？')
      if (!ok) {
        const output = wrapLobsterOutput(
          {
            traceId,
            task: params.task,
            finalUrl: params.startUrl || '',
            stats: { stepCount, latency_ms: Date.now() - startedAt },
            data: [{ via: 'stagehand', text: '已中止：高风险操作未获确认。' }],
            answer: '已中止：高风险操作未获确认。'
          },
          'stagehand',
          { confirmCount }
        )
        params.emit({ type: 'result', payload: output })
        return output
      }
    }

    params.emit({ type: 'state', payload: { phase: 'stagehand_execute', stepCount, pageUrl: params.startUrl || '' } })
    emitThinking('stagehand', '执行 Agent 任务…')

    const complex = isRecipeComplexPage(params.task, params.startUrl)
    if (complex) {
      try {
        emitThinking('stagehand_observe', '复杂页面：先 observe 可交互元素…')
        const observed = await stagehand.observe('列出当前页面可点击按钮、输入框、链接（前 12 个）')
        stepCount++
        if (observed) {
          emitLog('info', `Stagehand observe：${JSON.stringify(observed).slice(0, 500)}`)
        }
      } catch (e: any) {
        emitLog('warn', `Stagehand observe 跳过：${e?.message || e}`)
      }
    }

    const agent = stagehand.agent({
      model: { modelName, apiKey, ...(baseURL ? { baseURL } : {}) }
    })

    const recipeHint = stagehandHintsForPrompt(params.task, params.startUrl)
    const actTpl = recipeActTemplate(params.task, params.startUrl)
    const instructionParts = [
      actTpl ? `操作提示：${actTpl}` : '',
      recipeHint || '',
      params.startUrl ? `当前应在 ${params.startUrl}。请完成：${params.task}` : params.task
    ].filter(Boolean)
    const instruction = instructionParts.join('\n')

    const agentResult = await agent.execute(instruction)
    stepCount++

    let finalUrl = params.startUrl || ''
    try {
      finalUrl = stagehand.connectURL() ? params.startUrl || finalUrl : finalUrl
    } catch {}

    const answerText =
      String((agentResult as any)?.message ?? (agentResult as any)?.text ?? '').trim() ||
      JSON.stringify(agentResult).slice(0, 4000)

    let extracted: unknown = null
    try {
      extracted = await stagehand.extract(
        '提取与用户任务相关的结构化结果（标题、链接、表单状态等）',
        z.object({
          summary: z.string(),
          items: z
            .array(
              z.object({
                title: z.string().optional(),
                url: z.string().optional(),
                text: z.string().optional()
              })
            )
            .optional()
        })
      )
      stepCount++
    } catch {
      extracted = null
    }

    const output = wrapLobsterOutput(
      {
        traceId,
        task: params.task,
        finalUrl,
        stats: {
          stepCount,
          agentSteps: Number((agentResult as any)?.steps?.length ?? 0),
          latency_ms: Date.now() - startedAt
        },
        data: [
          {
            via: 'stagehand',
            text: answerText,
            url: finalUrl || undefined,
            items: (extracted as any)?.items || [],
            summary: (extracted as any)?.summary
          }
        ],
        answer: (extracted as any)?.summary || answerText
      },
      'stagehand',
      { confirmCount, answer: (extracted as any)?.summary || answerText }
    )

    params.emit({ type: 'result', payload: output })
    return output
  } catch (e: any) {
    const msg = e?.message ? String(e.message) : String(e)
    params.emit({ type: 'error', payload: { message: sanitize(msg), ts: Date.now() } })
    throw e
  } finally {
    try {
      if (storage.savePath) {
        const cookies = await stagehand.context.cookies()
        if (cookies?.length) {
          await persistCookiesStorage(storage.savePath, cookies as Array<Record<string, unknown>>)
          emitLog('info', `Stagehand：已保存 ${cookies.length} 条 cookie 到会话文件`)
        }
      }
    } catch {}
    try {
      await stagehand.close()
    } catch {}
  }
}
