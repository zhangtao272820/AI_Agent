import { defineEventHandler, readBody, createError } from 'h3'
import * as z from 'zod'
import { readText, safeResolve } from '../services/fileSystem'
import { computeSimpleMetrics, detectSmells, explainCode } from '../services/codeAnalyzer'
import { detectBugs } from '../services/bugDetector'
import { generateTestScaffold } from '../services/testGenerator'
import fs from 'node:fs/promises'

export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => null)
  const schema = z.object({
    path: z.string().min(1).optional(),
    text: z.string().min(1).optional(),
    actions: z.array(z.enum(['metrics', 'smells', 'bugs', 'explain', 'tests'])).default([
      'metrics',
      'smells',
      'bugs'
    ]),
    maxChars: z.number().int().min(1000).max(400000).default(120000),
    root: z.string().optional()
  })
  const parsed = schema
    .refine((v) => !!v.path || !!v.text, { message: 'Either path or text is required' })
    .safeParse(body)
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid request body' })
  }
  const { path: p, text, actions, maxChars, root } = parsed.data
  const content = p ? await readText(p, maxChars, root) : (text ?? '').slice(0, maxChars)
  const out: Record<string, unknown> = { path: p ?? null, source: p ? 'file' : 'snippet' }
  if (actions.includes('metrics')) out.metrics = computeSimpleMetrics(content)
  if (actions.includes('smells')) out.smells = detectSmells(content)
  if (actions.includes('bugs')) out.issues = detectBugs(content)
  if (actions.includes('explain')) out.explain = await explainCode(content, p || undefined)
  if (actions.includes('tests')) {
    if (!p) {
      throw createError({ statusCode: 400, statusMessage: 'tests action requires path' })
    }
    const pkgText = await fs.readFile(safeResolve('package.json', root), 'utf8').catch(() => '{}')
    const scaffold = await generateTestScaffold(p, maxChars, pkgText, root)
    out.tests = scaffold
  }
  return { ...out, root: root || undefined }
})
