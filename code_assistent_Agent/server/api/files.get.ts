import { defineEventHandler, getQuery, createError } from 'h3'
import { fileSha256, getRoot, readText, walkFiles } from '../services/fileSystem'
import * as z from 'zod'

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const schema = z.object({
    path: z.string().optional(),
    list: z.string().optional(),
    maxFiles: z.coerce.number().int().min(1).max(1000).default(500),
    exts: z
      .string()
      .optional()
      .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : null)),
    maxChars: z.coerce.number().int().min(1000).max(400000).default(120000),
    root: z.string().optional()
  })
  const parsed = schema.safeParse(q)
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid query' })
  }
  const { path: p, list, maxFiles, exts, maxChars, root } = parsed.data
  let resolvedRoot: string
  try {
    resolvedRoot = getRoot(root)
  } catch (e: any) {
    throw createError({ statusCode: 400, statusMessage: e?.message || 'Invalid root' })
  }
  if (list) {
    const files = await walkFiles({ maxFiles, includeExtensions: exts, root })
    return { files, root: resolvedRoot, defaultRoot: getRoot() }
  }
  if (!p) {
    throw createError({ statusCode: 400, statusMessage: 'Missing path' })
  }
  const content = await readText(p, maxChars, root)
  let meta: { sha256: string; bytes: number } | null = null
  try {
    const m = await fileSha256(p, root)
    meta = { sha256: m.sha256, bytes: m.bytes }
  } catch {}
  return { path: p, content, truncated: content.length >= maxChars, root: resolvedRoot, meta }
})
