import { createError, defineEventHandler, readBody } from 'h3'
import { z } from 'zod'
import { isInlineCodeRunEnabled, runInlineCodeSnippet } from '../../utils/code/managerInlineCodeRun'

const BodySchema = z.object({
  language: z.string().optional(),
  code: z.string().min(1).max(12_000)
})

export default defineEventHandler(async (event) => {
  if (!isInlineCodeRunEnabled()) {
    throw createError({ statusCode: 403, statusMessage: 'Inline code run is disabled (MANAGER_INLINE_CODE_RUN=0)' })
  }

  const parsed = BodySchema.safeParse(await readBody(event).catch(() => null))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid body' })
  }

  try {
    const result = await runInlineCodeSnippet(parsed.data)
    return { ok: result.ok, ...result }
  } catch (e: unknown) {
    throw createError({
      statusCode: 400,
      statusMessage: String((e as Error)?.message || e || 'run failed')
    })
  }
})
