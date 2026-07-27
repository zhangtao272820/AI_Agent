import { readBody } from 'h3'
import { useRuntimeConfig } from '#imports'
import { stopRun } from '../../services/lobsterRuntime'
import { assertLobsterAuth } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const cfg = useRuntimeConfig() as any
  assertLobsterAuth(event, cfg)
  const body = (await readBody(event).catch(() => null)) as any
  const runId = String(body?.runId ?? '').trim()
  if (!runId) {
    throw createError({ statusCode: 400, statusMessage: '缺少 runId' })
  }
  const ok = stopRun(runId)
  if (!ok) {
    throw createError({ statusCode: 404, statusMessage: 'runId 不存在' })
  }
  return { ok: true }
})

