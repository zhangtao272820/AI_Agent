/**
 * edit 任务 Git 隔离：agent/{runId} 分支或 worktree（P2-B4）
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import fs from 'node:fs/promises'
import { getRoot } from '../services/fileSystem'

const execFileAsync = promisify(execFile)

export type AgentWorktreeMode = 'off' | 'branch' | 'worktree'

export function resolveAgentWorktreeMode(env: NodeJS.ProcessEnv = process.env): AgentWorktreeMode {
  const v = String(env.CODE_AGENT_WORKTREE ?? '0').trim().toLowerCase()
  if (v === 'off' || v === '0' || v === 'false') return 'off'
  if (v === 'branch') return 'branch'
  return 'worktree'
}

function sanitizeRunId(runId: string): string {
  return String(runId || 'run')
    .trim()
    .replace(/[^\w.-]+/g, '-')
    .slice(0, 32) || 'run'
}

async function git(args: string[], cwd: string) {
  const { stdout, stderr } = await execFileAsync('git', args, { cwd, windowsHide: true, maxBuffer: 1024 * 1024 })
  return String(stdout || stderr || '').trim()
}

async function isGitRepo(root: string): Promise<boolean> {
  try {
    await git(['rev-parse', '--is-inside-work-tree'], root)
    return true
  } catch {
    return false
  }
}

export type AgentEditIsolation = {
  ok: boolean
  mode: AgentWorktreeMode
  branch?: string
  worktreePath?: string
  previousBranch?: string
  error?: string
}

/** edit 开始前创建/切换 agent 分支（或 worktree） */
export async function prepareAgentEditIsolation(input: {
  runId: string
  root?: string
  mode?: AgentWorktreeMode
}): Promise<AgentEditIsolation> {
  const mode = input.mode ?? resolveAgentWorktreeMode()
  if (mode === 'off') return { ok: true, mode: 'off' }

  const root = getRoot(input.root)
  if (!(await isGitRepo(root))) {
    return { ok: false, mode, error: 'not_a_git_repo' }
  }

  const branch = `agent/${sanitizeRunId(input.runId)}`
  let previousBranch = ''
  try {
    previousBranch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], root)
  } catch {
    previousBranch = ''
  }

  try {
    if (mode === 'branch') {
      try {
        await git(['rev-parse', '--verify', branch], root)
        await git(['checkout', branch], root)
      } catch {
        await git(['checkout', '-b', branch], root)
      }
      return { ok: true, mode, branch, previousBranch: previousBranch || undefined }
    }

    const worktreeRel = path.join('.agent-worktrees', sanitizeRunId(input.runId))
    const worktreePath = path.join(root, worktreeRel)
    await fs.mkdir(path.dirname(worktreePath), { recursive: true }).catch(() => undefined)
    try {
      await git(['worktree', 'add', worktreePath, '-b', branch], root)
    } catch {
      await git(['worktree', 'add', '--force', worktreePath, branch], root)
    }
    return {
      ok: true,
      mode: 'worktree',
      branch,
      worktreePath: worktreeRel.replace(/\\/g, '/'),
      previousBranch: previousBranch || undefined,
    }
  } catch (e: unknown) {
    return { ok: false, mode, error: String((e as Error)?.message ?? e) }
  }
}

/** 拒绝 Agent 改动：git restore 指定文件 */
export async function restoreAgentEditedFiles(input: {
  paths: string[]
  root?: string
}): Promise<{ ok: boolean; restored: string[]; error?: string }> {
  const root = getRoot(input.root)
  const paths = input.paths.map((p) => String(p || '').trim()).filter(Boolean)
  if (!paths.length) return { ok: false, restored: [], error: 'no_paths' }
  if (!(await isGitRepo(root))) return { ok: false, restored: [], error: 'not_a_git_repo' }
  try {
    await git(['restore', '--source=HEAD', '--', ...paths], root)
    return { ok: true, restored: paths }
  } catch (e: unknown) {
    return { ok: false, restored: [], error: String((e as Error)?.message ?? e) }
  }
}
