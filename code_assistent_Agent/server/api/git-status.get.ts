import { defineEventHandler, getQuery } from 'h3'
import * as z from 'zod'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { getRoot, toPosix } from '../services/fileSystem'

const execFileAsync = promisify(execFile)

function parsePorcelainZ(buf: Buffer) {
  const text = buf.toString('utf8')
  const parts = text.split('\0').filter(Boolean)
  const out: Record<string, string> = {}
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i]!
    const xy = entry.slice(0, 2)
    const rest = entry.slice(3)
    if (!rest) continue
    if ((xy[0] === 'R' || xy[0] === 'C') && i + 1 < parts.length) {
      const newPath = parts[i + 1]!
      out[toPosix(newPath)] = xy
      i += 1
      continue
    }
    out[toPosix(rest)] = xy
  }
  return out
}

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const parsed = z
    .object({
      root: z.string().optional(),
      timeoutMs: z.coerce.number().int().min(1000).max(30_000).default(6000)
    })
    .safeParse(q)
  if (!parsed.success) {
    return { isRepo: false, statuses: {} as Record<string, string> }
  }

  const rootOverride = parsed.data.root ? path.resolve(parsed.data.root) : undefined
  const cwd = getRoot(rootOverride)

  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain=v1', '-z'], {
      cwd,
      timeout: parsed.data.timeoutMs,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024
    })
    const statuses = parsePorcelainZ(Buffer.isBuffer(stdout) ? stdout : Buffer.from(String(stdout || ''), 'utf8'))
    return { isRepo: true, statuses }
  } catch {
    return { isRepo: false, statuses: {} as Record<string, string> }
  }
})

