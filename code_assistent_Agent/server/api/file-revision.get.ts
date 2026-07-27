import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { getQuery } from 'h3'
import path from 'node:path'
import { getRoot, toPosix } from '../services/fileSystem'

const execFileAsync = promisify(execFile)

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const filePath = String(q.path ?? '').trim()
  const rev = String(q.rev ?? 'HEAD').trim() || 'HEAD'
  const rootOverride = q.root ? path.resolve(String(q.root)) : undefined
  if (!filePath) {
    throw createError({ statusCode: 400, statusMessage: 'path required' })
  }

  const cwd = getRoot(rootOverride)
  const rel = toPosix(filePath)
  try {
    const { stdout } = await execFileAsync('git', ['show', `${rev}:${rel}`], {
      cwd,
      timeout: 8000,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    })
    return { ok: true, path: rel, rev, content: String(stdout ?? '') }
  } catch (e: unknown) {
    const err = e as { code?: number; stderr?: string; message?: string }
    if (err?.code === 128 || /does not exist|bad revision/i.test(String(err.stderr || err.message || ''))) {
      return { ok: true, path: rel, rev, content: '', missing: true }
    }
    throw createError({
      statusCode: 400,
      statusMessage: String(err?.stderr || err?.message || 'git show failed'),
    })
  }
})
