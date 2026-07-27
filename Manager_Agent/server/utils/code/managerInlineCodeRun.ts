import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const execFileAsync = promisify(execFile)

const MAX_CODE_LEN = 12_000
const TIMEOUT_MS = 15_000

const BLOCKED =
  /(?:import\s+os|from\s+os\s+import|subprocess|child_process|require\s*\(\s*['"]child_process|require\s*\(\s*['"]fs['"]|eval\s*\(|Function\s*\(|process\.env|__import__\s*\(\s*['"]os)/i

export type InlineCodeLanguage = 'python' | 'javascript' | 'node' | 'js' | 'py' | 'typescript' | 'ts'

export function normalizeInlineCodeLanguage(raw?: string | null): 'python' | 'javascript' {
  const v = String(raw ?? '').trim().toLowerCase()
  if (v === 'py' || v === 'python') return 'python'
  return 'javascript'
}

export function isInlineCodeRunEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.MANAGER_INLINE_CODE_RUN ?? '1').trim() !== '0'
}

export async function runInlineCodeSnippet(input: {
  language?: string | null
  code: string
}): Promise<{ ok: boolean; stdout: string; stderr: string; language: 'python' | 'javascript'; ms: number }> {
  const code = String(input.code ?? '').trim()
  if (!code) throw new Error('code is empty')
  if (code.length > MAX_CODE_LEN) throw new Error(`code exceeds ${MAX_CODE_LEN} chars`)
  if (BLOCKED.test(code)) throw new Error('code contains blocked pattern')

  const language = normalizeInlineCodeLanguage(input.language)
  const dir = await mkdtemp(path.join(tmpdir(), 'mgr-inline-code-'))
  const started = Date.now()
  try {
    if (language === 'python') {
      const file = path.join(dir, 'snippet.py')
      await writeFile(file, code, 'utf8')
      const py = process.platform === 'win32' ? 'python' : 'python3'
      const { stdout, stderr } = await execFileAsync(py, [file], {
        timeout: TIMEOUT_MS,
        maxBuffer: 512 * 1024,
        cwd: dir,
        windowsHide: true
      } as Parameters<typeof execFileAsync>[2])
      return {
        ok: true,
        stdout: String(stdout ?? ''),
        stderr: String(stderr ?? ''),
        language,
        ms: Date.now() - started
      }
    }

    const file = path.join(dir, 'snippet.mjs')
    await writeFile(file, code, 'utf8')
    const { stdout, stderr } = await execFileAsync('node', [file], {
      timeout: TIMEOUT_MS,
      maxBuffer: 512 * 1024,
      cwd: dir,
      windowsHide: true
    } as Parameters<typeof execFileAsync>[2])
    return {
      ok: true,
      stdout: String(stdout ?? ''),
      stderr: String(stderr ?? ''),
      language: 'javascript',
      ms: Date.now() - started
    }
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; message?: string; killed?: boolean }
    return {
      ok: false,
      stdout: String(err?.stdout ?? ''),
      stderr: String(err?.stderr ?? err?.message ?? e ?? 'run failed'),
      language,
      ms: Date.now() - started
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}
