import { defineEventHandler, readBody, createError } from 'h3'
import * as z from 'zod'
import { writeText } from '../services/fileSystem'

type Actor = { sub: string; scopes: string[] }

function hasAnyScope(actor: Actor | undefined, required: string[]) {
  if (!actor) return false
  const set = new Set(actor.scopes)
  return required.some((s) => set.has(s))
}

export default defineEventHandler(async (event) => {
  const runtimeConfig = useRuntimeConfig() as any
  const toolsCfg = (runtimeConfig.tools ?? {}) as any
  if (toolsCfg?.writeEnabled !== true) {
    throw createError({ statusCode: 403, statusMessage: 'write tool is disabled' })
  }

  const authCfg = (runtimeConfig.auth ?? {}) as any
  const requireAuth = toolsCfg?.requireAuthForDangerousTools !== false && authCfg?.enabled === true

  const actor = ((event as any).context?.auth ?? undefined) as Actor | undefined
  if (requireAuth && !actor) {
    throw createError({ statusCode: 401, statusMessage: 'unauthorized' })
  }

  const requireScopes = authCfg?.requireScopesForDangerousTools !== false
  if (requireAuth && requireScopes) {
    const required = Array.isArray(authCfg?.dangerousToolScopes) ? authCfg.dangerousToolScopes : []
    const scopes = required.length ? required : ['write:repo']
    if (!hasAnyScope(actor, scopes)) {
      throw createError({ statusCode: 403, statusMessage: 'missing scope: write:repo' })
    }
  }

  const body = await readBody(event).catch(() => null)
  const parsed = z
    .object({
      path: z.string().min(1),
      content: z.string(),
      expectedSha256: z.string().min(16),
      root: z.string().optional(),
      maxBytes: z.number().int().min(1000).max(2_000_000).optional()
    })
    .safeParse(body)
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid request body' })
  }

  try {
    const meta = await writeText({
      path: parsed.data.path,
      content: parsed.data.content,
      expectedSha256: parsed.data.expectedSha256,
      root: parsed.data.root,
      maxBytes: parsed.data.maxBytes
    })
    return { ok: true, ...meta }
  } catch (err: any) {
    const msg = String(err?.message ?? 'write failed')
    const code = /File has changed/i.test(msg) ? 409 : 400
    throw createError({ statusCode: code, statusMessage: msg })
  }
})
