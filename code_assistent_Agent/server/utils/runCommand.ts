/**
 * 受控终端：白名单命令执行（P2-B5）
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { getRoot } from '../services/fileSystem'
import { getCodeAgentEnv } from './code_agent_env'

const execFileAsync = promisify(execFile)

export type RunCommandResult = {
  ok: boolean
  argv: string[]
  exitCode: number | null
  stdout: string
  stderr: string
  ms: number
  error?: string
}

type AllowRule = {
  bin: string
  subcommands?: string[]
}

const DEFAULT_RULES: AllowRule[] = [
  { bin: 'rg', subcommands: [] },
  { bin: 'git', subcommands: ['status', 'diff', 'log', 'branch', 'rev-parse', 'show', 'stash', 'worktree'] },
  { bin: 'pnpm', subcommands: ['run', 'exec', 'typecheck', 'lint', 'test'] },
  { bin: 'npm', subcommands: ['run', 'exec', 'test'] },
  { bin: 'npx', subcommands: ['tsx', 'vitest', 'eslint', 'tsc'] },
  { bin: 'node', subcommands: ['--version'] },
  { bin: 'python', subcommands: ['-m'] },
]

function parseAllowlistRaw(raw: string | undefined): AllowRule[] {
  const s = String(raw ?? '').trim()
  if (!s) return DEFAULT_RULES
  const rules: AllowRule[] = []
  for (const part of s.split(';').map((x) => x.trim()).filter(Boolean)) {
    const [bin, subs] = part.split(':')
    const b = String(bin ?? '').trim()
    if (!b) continue
    rules.push({
      bin: b,
      subcommands: subs ? subs.split(',').map((x) => x.trim()).filter(Boolean) : [],
    })
  }
  return rules.length ? rules : DEFAULT_RULES
}

export function resolveCommandAllowlist(env: NodeJS.ProcessEnv = process.env): AllowRule[] {
  return parseAllowlistRaw(env.CODE_RUN_COMMAND_ALLOWLIST)
}

function resolveBin(argv0: string, isWin: boolean): string {
  const b = String(argv0 || '').trim()
  if (!b) return b
  if (b.includes('/') || b.includes('\\')) return b
  if (isWin && !/\.(cmd|exe|bat)$/i.test(b)) {
    if (b === 'npm' || b === 'npx' || b === 'pnpm') return `${b}.cmd`
  }
  return b
}

export function validateAllowlistedCommand(
  argv: string[],
  rules: AllowRule[] = resolveCommandAllowlist(),
): { ok: true } | { ok: false; reason: string } {
  if (!argv.length) return { ok: false, reason: 'argv 为空' }
  const bin = path.basename(String(argv[0] || '').replace(/\.cmd$/i, ''))
  const rule = rules.find((r) => r.bin === bin)
  if (!rule) return { ok: false, reason: `命令不在白名单：${bin}` }

  const sub = String(argv[1] || '').trim()
  if (rule.subcommands && rule.subcommands.length > 0) {
    if (['git', 'pnpm', 'npm', 'npx'].includes(bin)) {
      if (!sub) return { ok: false, reason: `${bin} 缺少子命令` }
      if (!rule.subcommands.includes(sub)) {
        return { ok: false, reason: `${bin} ${sub} 不在白名单` }
      }
    }
    if (bin === 'python' && sub !== '-m') {
      return { ok: false, reason: 'python 仅允许 python -m …' }
    }
  }

  const blob = argv.join(' ')
  if (/(rm\s+-rf|del\s+\/|format\s+|shutdown|mkfs)/i.test(blob)) {
    return { ok: false, reason: '危险命令模式被拦截' }
  }
  return { ok: true }
}

export async function runAllowlistedCommand(input: {
  argv: string[]
  cwd?: string
  timeoutMs?: number
  root?: string
}): Promise<RunCommandResult> {
  const env = getCodeAgentEnv()
  if (!env.runCommandEnabled) {
    return {
      ok: false,
      argv: input.argv,
      exitCode: null,
      stdout: '',
      stderr: '',
      ms: 0,
      error: 'RUN_COMMAND 未启用（CODE_RUN_COMMAND_ENABLED=0）',
    }
  }

  const argv = input.argv.map((a) => String(a ?? '').trim()).filter((a, i) => i === 0 || a.length > 0)
  const check = validateAllowlistedCommand(argv, resolveCommandAllowlist())
  if (!check.ok) {
    return {
      ok: false,
      argv,
      exitCode: null,
      stdout: '',
      stderr: '',
      ms: 0,
      error: check.reason,
    }
  }

  const cwd = path.resolve(input.cwd || input.root || getRoot())
  const repoRoot = path.resolve(getRoot(input.root))
  if (!cwd.startsWith(repoRoot)) {
    return {
      ok: false,
      argv,
      exitCode: null,
      stdout: '',
      stderr: '',
      ms: 0,
      error: 'cwd 必须在仓库根目录内',
    }
  }

  const timeoutMs = Math.max(5_000, Number(input.timeoutMs ?? env.runCommandTimeoutMs))
  const isWin = process.platform === 'win32'
  const file = resolveBin(argv[0]!, isWin)
  const args = argv.slice(1)
  const startedAt = Date.now()

  try {
    const { stdout, stderr } = await execFileAsync(file, args, {
      cwd,
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 8,
      env: {
        PATH: process.env.PATH,
        PATHEXT: process.env.PATHEXT,
        SystemRoot: process.env.SystemRoot,
        HOME: process.env.HOME,
        USER: process.env.USER,
        NODE_ENV: process.env.NODE_ENV,
      },
    } as any)
    return {
      ok: true,
      argv,
      exitCode: 0,
      stdout: String(stdout || ''),
      stderr: String(stderr || ''),
      ms: Date.now() - startedAt,
    }
  } catch (e: any) {
    const timedOut = e?.killed === true || e?.signal === 'SIGTERM'
    return {
      ok: false,
      argv,
      exitCode: typeof e?.code === 'number' ? e.code : null,
      stdout: String(e?.stdout || ''),
      stderr: String(e?.stderr || ''),
      ms: Date.now() - startedAt,
      error: timedOut ? `timeout (${timeoutMs}ms)` : String(e?.message || e),
    }
  }
}
