import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { getRoot } from '../services/fileSystem'
import { getCodeAgentEnv } from './code_agent_env'
import { runAllowlistedCommand } from './runCommand'
import { resolvePackageManager } from './packageScripts'

const execFileAsync = promisify(execFile)

export type SandboxMode = 'off' | 'subprocess' | 'docker'

export type SandboxRunInput = {
  script: string
  args?: string[]
  cwd?: string
  timeoutMs?: number
  env?: Record<string, string>
}

export type SandboxRunResult = {
  ok: boolean
  exitCode: number | null
  stdout: string
  stderr: string
  ms: number
  mode: SandboxMode
  error?: string
}

const DEFAULT_ENV_KEYS = ['PATH', 'PATHEXT', 'SystemRoot', 'HOME', 'USER', 'LANG', 'LC_ALL', 'NODE_ENV', 'npm_config_cache']

function parseSandboxMode(): SandboxMode {
  const v = String(process.env.CODE_SANDBOX_MODE ?? 'subprocess').trim().toLowerCase()
  if (v === 'off' || v === '0' || v === 'false') return 'off'
  if (v === 'docker') return 'docker'
  return 'subprocess'
}

function whitelistEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const k of DEFAULT_ENV_KEYS) {
    const val = process.env[k]
    if (val != null && String(val).trim()) out[k] = val
  }
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (k && v != null) out[k] = v
    }
  }
  return out
}

async function runSubprocessSandbox(input: SandboxRunInput): Promise<SandboxRunResult> {
  const cwd = path.resolve(input.cwd || getRoot())
  const timeoutMs = Math.max(5_000, Number(input.timeoutMs ?? 90_000))
  const startedAt = Date.now()

  if (getCodeAgentEnv().runCommandEnabled) {
    const pm = resolvePackageManager(input.cwd)
    const argv =
      pm === 'pnpm'
        ? input.args?.length
          ? ['pnpm', 'run', input.script, '--', ...input.args]
          : ['pnpm', 'run', input.script]
        : input.args?.length
          ? ['npm', 'run', input.script, '--', ...input.args]
          : ['npm', 'run', input.script]
    const out = await runAllowlistedCommand({
      argv,
      cwd,
      timeoutMs,
      root: input.cwd,
    })
    return {
      ok: out.ok,
      exitCode: out.exitCode,
      stdout: out.stdout,
      stderr: out.stderr,
      ms: out.ms,
      mode: 'subprocess',
      error: out.error,
    }
  }

  const isWin = process.platform === 'win32'
  const cmd = isWin ? 'npm.cmd' : 'npm'
  const npmArgs = input.args?.length ? ['run', input.script, '--', ...input.args] : ['run', input.script]
  try {
    const { stdout, stderr } = await execFileAsync(cmd, npmArgs, {
      cwd,
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 8,
      env: whitelistEnv(input.env)
    } as any)
    return {
      ok: true,
      exitCode: 0,
      stdout: String(stdout || ''),
      stderr: String(stderr || ''),
      ms: Date.now() - startedAt,
      mode: 'subprocess'
    }
  } catch (e: any) {
    const timedOut = e?.killed === true || e?.signal === 'SIGTERM'
    return {
      ok: false,
      exitCode: typeof e?.code === 'number' ? e.code : null,
      stdout: String(e?.stdout || ''),
      stderr: String(e?.stderr || ''),
      ms: Date.now() - startedAt,
      mode: 'subprocess',
      error: timedOut ? `timeout (${timeoutMs}ms)` : String(e?.message || e)
    }
  }
}

async function runDockerSandbox(input: SandboxRunInput): Promise<SandboxRunResult> {
  const cwd = path.resolve(input.cwd || getRoot())
  const timeoutMs = Math.max(5_000, Number(input.timeoutMs ?? 90_000))
  const image = String(process.env.CODE_SANDBOX_IMAGE || 'node:20-bullseye-slim').trim()
  const memory = String(process.env.CODE_SANDBOX_MEMORY_MB || '512').trim()
  const npmArgs = input.args?.length ? ['run', input.script, '--', ...input.args] : ['run', input.script]
  const inner = `npm ${npmArgs.map((a) => JSON.stringify(a)).join(' ')}`
  const startedAt = Date.now()

  return await new Promise<SandboxRunResult>((resolve) => {
    let stdout = ''
    let stderr = ''
    let child: ChildProcess | null = null
    const timer = setTimeout(() => {
      try {
        child?.kill('SIGTERM')
      } catch {}
      resolve({
        ok: false,
        exitCode: null,
        stdout,
        stderr,
        ms: Date.now() - startedAt,
        mode: 'docker',
        error: `timeout (${timeoutMs}ms)`
      })
    }, timeoutMs)

    const args = [
      'run',
      '--rm',
      '--network=none',
      `--memory=${memory}m`,
      '-v',
      `${cwd}:/workspace:ro`,
      '-w',
      '/workspace',
      image,
      'sh',
      '-lc',
      inner
    ]
    child = spawn('docker', args, { windowsHide: true })
    child.stdout?.on('data', (c) => {
      stdout += String(c)
    })
    child.stderr?.on('data', (c) => {
      stderr += String(c)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({
        ok: code === 0,
        exitCode: code,
        stdout,
        stderr,
        ms: Date.now() - startedAt,
        mode: 'docker',
        error: code === 0 ? undefined : `exit ${code}`
      })
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({
        ok: false,
        exitCode: null,
        stdout,
        stderr,
        ms: Date.now() - startedAt,
        mode: 'docker',
        error: String(err?.message || err)
      })
    })
  })
}

export function getSandboxMode(): SandboxMode {
  return parseSandboxMode()
}

/** 统一 npm script 沙箱入口：subprocess 受限 env；docker 可选隔离 */
export async function runSandboxNpmScript(input: SandboxRunInput): Promise<SandboxRunResult> {
  const mode = parseSandboxMode()
  if (mode === 'off') return runSubprocessSandbox(input)
  if (mode === 'docker') {
    const docker = await runDockerSandbox(input)
    if (docker.error && docker.error.includes('ENOENT')) {
      return runSubprocessSandbox(input)
    }
    return docker
  }
  return runSubprocessSandbox(input)
}
