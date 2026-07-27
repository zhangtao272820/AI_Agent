/**
 * edit 结束产物：unified diff · stat 摘要（P2-B4）
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { getRoot } from '../services/fileSystem'

const execFileAsync = promisify(execFile)

export type EditArtifacts = {
  files: string[]
  diff_stat: string
  unified_diff: string
  branch?: string
}

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, windowsHide: true, maxBuffer: 4 * 1024 * 1024 })
  return String(stdout || '').trim()
}

export async function collectEditArtifacts(input: {
  files: string[]
  root?: string
  branch?: string
  maxDiffChars?: number
}): Promise<EditArtifacts | null> {
  const files = [...new Set(input.files.map((f) => String(f || '').trim()).filter(Boolean))]
  if (!files.length) return null

  const root = getRoot(input.root)
  const maxDiff = Math.max(2000, Number(input.maxDiffChars ?? 24_000))

  try {
    await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root, windowsHide: true })
  } catch {
    return null
  }

  let diff_stat = ''
  let unified_diff = ''
  try {
    diff_stat = await git(['diff', '--stat', '--', ...files], root)
  } catch {
    diff_stat = ''
  }
  try {
    unified_diff = (await git(['diff', '--', ...files], root)).slice(0, maxDiff)
  } catch {
    unified_diff = ''
  }

  if (!diff_stat && !unified_diff) return null

  return {
    files,
    diff_stat,
    unified_diff,
    branch: input.branch,
  }
}
