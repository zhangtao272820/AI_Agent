import { getQuery } from 'h3'
import { useRuntimeConfig } from '#imports'
import { getRunScreenshot } from '../../services/lobsterRuntime'
import { assertLobsterAuth } from '../../utils/auth'

export default defineEventHandler((event) => {
  const cfg = useRuntimeConfig() as any
  assertLobsterAuth(event, cfg)
  const q = getQuery(event) as any
  const runId = String(q?.runId ?? '').trim()
  if (!runId) {
    throw createError({ statusCode: 400, statusMessage: '缺少 runId' })
  }
  const dataUrl = getRunScreenshot(runId)
  if (!dataUrl) {
    throw createError({ statusCode: 404, statusMessage: '截图不存在' })
  }
  return { runId, dataUrl }
})

