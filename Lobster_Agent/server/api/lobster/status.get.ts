import { getQuery } from 'h3'
import { useRuntimeConfig } from '#imports'
import { getRun, getRunStatus } from '../../services/lobsterRuntime'
import { assertLobsterAuth } from '../../utils/auth'
import { buildGuiAgentResult } from '../../utils/agent_result'
import { ensureLobsterGuiFinalPayload } from '../../services/lobsterGuiFinalPayload'

export default defineEventHandler((event) => {
  const cfg = useRuntimeConfig() as any
  assertLobsterAuth(event, cfg)
  const q = getQuery(event) as any
  const runId = String(q?.runId ?? '').trim()
  if (!runId) {
    throw createError({ statusCode: 400, statusMessage: '缺少 runId' })
  }
  const status = getRunStatus(runId)
  if (!status) {
    throw createError({ statusCode: 404, statusMessage: 'runId 不存在' })
  }
  const r = getRun(runId)
  const resultRaw = r?.result || null
  const st = String(status.status || '').toLowerCase()
  // 与 WS `_ws` 对齐：done/error 时附带 agentResult，避免总管 poll 路径「有执行无 final」
  let agentResult: ReturnType<typeof buildGuiAgentResult> | undefined
  let result = resultRaw
  if (resultRaw && typeof resultRaw === 'object' && (st === 'done' || st === 'error' || st === 'canceled')) {
    const row = ensureLobsterGuiFinalPayload(
      { ...(resultRaw as Record<string, unknown>) },
      String((resultRaw as any).task || ''),
    )
    result = row
    agentResult = buildGuiAgentResult({
      data: Array.isArray(row.data) ? (row.data as Record<string, unknown>[]) : [],
      finalUrl: String(row.finalUrl || ''),
      task: String(row.task || ''),
      trace_id: String(row.traceId || runId),
      latency_ms: Number(row.latencyMs || 0) || undefined,
      answer: String(row.answer || ''),
      failureType: String(row.failureType || ''),
      status: st === 'done' ? 'done' : 'error',
      stats: row.stats && typeof row.stats === 'object' ? (row.stats as Record<string, unknown>) : undefined,
      error_code: st === 'done' ? undefined : String(status.error || row.failureType || 'run_error'),
    })
  }
  return {
    ...status,
    screenshotDataUrl: r?.lastScreenshotDataUrl || null,
    result,
    ...(agentResult ? { agentResult } : {}),
  }
})

