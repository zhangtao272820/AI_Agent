import { readBody } from 'h3'
import { useRuntimeConfig } from '#imports'
import { assertLobsterAuth } from '../../../utils/auth'
import { importStorageStateJson } from '../../../services/sessionStorage'

/** 导入 Playwright storageState（cookie / localStorage）供后续 gui 任务复用登录态 */
export default defineEventHandler(async (event) => {
  const cfg = useRuntimeConfig() as any
  assertLobsterAuth(event, cfg)
  const body = (await readBody(event).catch(() => null)) as any
  const profile = String(body?.profile ?? body?.storageProfile ?? '').trim()
  const storage = body?.storage ?? body?.storageState ?? body?.cookies
  if (!profile) {
    throw createError({ statusCode: 400, statusMessage: '缺少 profile / storageProfile' })
  }
  if (!storage || typeof storage !== 'object') {
    throw createError({ statusCode: 400, statusMessage: '缺少 storage / storageState（JSON 对象）' })
  }
  const storageDir = String(cfg?.lobster?.storageDir || process.env.LOBSTER_SESSION_DIR || '').trim() || undefined
  const path = await importStorageStateJson(profile, storage, storageDir)
  return { ok: true, profile, path }
})
