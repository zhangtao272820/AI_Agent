import fs from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

export const REPO_ROOT =
  (process.env.PROJECT_DIR && path.resolve(process.env.PROJECT_DIR)) || process.cwd()

function safeRandomUUID() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.randomBytes(16)
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function isSensitiveRepoPath(repoRelativePosixPath: string) {
  const p = repoRelativePosixPath.replaceAll('\\', '/').replace(/^\/+/, '')
  if (!p) return false
  const lower = p.toLowerCase()
  if (lower === '.env' || (lower.startsWith('.env.') && lower !== '.env.example')) return true
  if (lower.includes('/.env') && !lower.endsWith('/.env.example')) return true
  if (lower.startsWith('.data/') || lower === '.data') return true

  const base = path.posix.basename(lower)
  if (
    base === '.npmrc' ||
    base === '.yarnrc' ||
    base === '.yarnrc.yml' ||
    base === '.pnpmrc' ||
    base === '.gitconfig' ||
    base === 'id_rsa' ||
    base === 'id_ed25519'
  ) {
    return true
  }

  const ext = path.posix.extname(lower)
  if (
    ext === '.pem' ||
    ext === '.key' ||
    ext === '.p12' ||
    ext === '.pfx' ||
    ext === '.crt' ||
    ext === '.cer' ||
    ext === '.der' ||
    ext === '.jks' ||
    ext === '.kdbx'
  ) {
    return true
  }

  return false
}

function isRestrictedWritePath(repoRelativePosixPath: string) {
  const p = repoRelativePosixPath.replaceAll('\\', '/').replace(/^\/+/, '')
  const top = p.split('/').filter(Boolean)[0]?.toLowerCase() ?? ''
  if (!top) return false
  if (top === '.git') return true
  if (top === '.nuxt') return true
  if (top === '.output') return true
  if (top === '.data') return true
  if (top === 'dist') return true
  if (top === 'node_modules') return true
  return false
}

function parseAllowedRoots() {
  const raw = process.env.ALLOWED_ROOTS ?? ''
  const roots = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((p) => path.resolve(p))
  if (!roots.length) roots.push(REPO_ROOT)
  return roots
}

function isWithinRoot(root: string, candidate: string) {
  const rel = path.relative(root, candidate)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

export function getRoot(rootOverride?: string) {
  if (!rootOverride) {
    const sub = String(process.env.CODE_REPO_SUBPATH ?? '').trim().replace(/^\/+/, '').replace(/\/+$/, '')
    if (sub) return path.resolve(REPO_ROOT, sub)
    return REPO_ROOT
  }
  const raw = String(rootOverride).trim()
  // Docker/Linux 无法直接访问宿主机盘符路径（如 E:\Agent）
  if (process.platform !== 'win32' && /^[A-Za-z]:[\\/]/.test(raw)) {
    throw new Error(
      `容器内无法访问 Windows 路径「${raw}」。请把项目根目录设为 /workspace（需挂载仓库），或留空使用默认 ${REPO_ROOT}`,
    )
  }
  const candidate = path.resolve(raw)
  const allowed = parseAllowedRoots()
  if (!allowed.some((r) => isWithinRoot(r, candidate))) {
    throw new Error(
      `Root override is not allowed（候选 ${candidate}；允许：${allowed.join(', ')}）`,
    )
  }
  return candidate
}

const DEFAULT_IGNORED_DIRS = new Set([
  '.git',
  '.nuxt',
  '.output',
  '.data',
  '.vscode',
  'dist',
  'node_modules'
])

export function toPosix(p: string) {
  return p.split(path.sep).join('/')
}

export function safeResolve(repoRelativePath: string, rootOverride?: string) {
  const root = getRoot(rootOverride)
  const normalized = repoRelativePath.replaceAll('\\', '/').replace(/^\/+/, '')
  if (isSensitiveRepoPath(normalized)) {
    throw new Error('Access to this path is restricted')
  }
  const resolved = path.resolve(root, normalized)
  const rel = path.relative(root, resolved)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Path must be within repository root')
  }
  return resolved
}

export async function fileSha256(repoPath: string, rootOverride?: string) {
  const full = safeResolve(repoPath, rootOverride)
  const file = await fs.open(full, 'r')
  try {
    const hasher = crypto.createHash('sha256')
    const chunk = Buffer.allocUnsafe(128 * 1024)
    let total = 0
    while (true) {
      const { bytesRead } = await file.read(chunk, 0, chunk.length, null)
      if (!bytesRead) break
      total += bytesRead
      hasher.update(chunk.subarray(0, bytesRead))
    }
    return { path: repoPath, sha256: hasher.digest('hex'), bytes: total }
  } finally {
    await file.close().catch(() => {})
  }
}

export async function readText(repoPath: string, maxChars: number, rootOverride?: string) {
  const full = safeResolve(repoPath, rootOverride)
  const stat = await fs.stat(full)
  if (!stat.isFile()) throw new Error('Path is not a file')
  const file = await fs.open(full, 'r')
  try {
    const decoder = new TextDecoder('utf-8')
    const chunk = Buffer.allocUnsafe(64 * 1024)
    let out = ''
    let done = false
    while (!done && out.length <= maxChars) {
      const { bytesRead } = await file.read(chunk, 0, chunk.length, null)
      if (!bytesRead) break
      out += decoder.decode(chunk.subarray(0, bytesRead), { stream: true })
      if (out.length > maxChars) done = true
    }
    out += decoder.decode()
    if (out.length > maxChars) return out.slice(0, maxChars)
    return out
  } finally {
    await file.close().catch(() => {})
  }
}

export async function writeText(params: {
  path: string
  content: string
  expectedSha256?: string
  root?: string
  maxBytes?: number
}) {
  const maxBytes =
    Number.isFinite(params.maxBytes) && (params.maxBytes as number) > 0
      ? Number(params.maxBytes)
      : 800_000
  const normalized = params.path.replaceAll('\\', '/').replace(/^\/+/, '')
  if (isSensitiveRepoPath(normalized)) {
    throw new Error('Access to this path is restricted')
  }
  if (isRestrictedWritePath(normalized)) {
    throw new Error('Writes to this path are restricted')
  }
  const full = safeResolve(normalized, params.root)
  const buf = Buffer.from(params.content ?? '', 'utf8')
  if (buf.length > maxBytes) {
    throw new Error('Content too large')
  }

  const expected = typeof params.expectedSha256 === 'string' ? params.expectedSha256.trim() : ''
  if (expected) {
    try {
      const cur = await fileSha256(normalized, params.root)
      if (cur.sha256 !== expected) {
        throw new Error('File has changed')
      }
    } catch (err) {
      const msg = String((err as any)?.message ?? '')
      if (!/Path is not a file/i.test(msg) && !/no such file/i.test(msg)) throw err
      throw new Error('File has changed')
    }
  }

  await fs.mkdir(path.dirname(full), { recursive: true }).catch(() => {})
  const tmp = `${full}.${safeRandomUUID()}.tmp`
  await fs.writeFile(tmp, buf)
  try {
    await fs.rename(tmp, full)
  } catch {
    await fs.writeFile(full, buf)
    await fs.rm(tmp, { force: true }).catch(() => {})
  }
  return fileSha256(normalized, params.root)
}

export async function walkFiles(params: {
  root?: string
  maxFiles: number
  includeExtensions?: string[] | null
  ignoredDirs?: Set<string>
}) {
  const { root, maxFiles, includeExtensions, ignoredDirs = DEFAULT_IGNORED_DIRS } = params
  const dir = getRoot(root)
  const results: string[] = []
  const queue: string[] = [dir]
  while (queue.length && results.length < maxFiles) {
    const current = queue.shift()
    if (!current) break
    let entries: Dirent[]
    try {
      entries = await fs.readdir(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (results.length >= maxFiles) break
      if (entry.name.startsWith('.DS_Store')) continue
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        if (ignoredDirs.has(entry.name)) continue
        queue.push(full)
        continue
      }
      if (!entry.isFile()) continue
      if (includeExtensions?.length) {
        const ext = path.extname(entry.name).toLowerCase().replace('.', '')
        if (!includeExtensions.includes(ext)) continue
      }
      const rel = toPosix(path.relative(dir, full))
      if (isSensitiveRepoPath(rel)) continue
      results.push(rel)
    }
  }
  return results.sort()
}

export async function searchInRepo(params: {
  query: string
  globLikeExt?: string[] | null
  maxMatches: number
  maxFiles: number
  root?: string
}) {
  const { query, globLikeExt, maxMatches, maxFiles, root } = params
  const files = await walkFiles({ maxFiles, includeExtensions: globLikeExt ?? null, root })
  const needle = query.toLowerCase()
  const matches: Array<{ file: string; line: number; text: string }> = []
  for (const file of files) {
    if (matches.length >= maxMatches) break
    let content: string
    try {
      content = await readText(file, 200_000, root)
    } catch {
      continue
    }
    const lines = content.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      if (matches.length >= maxMatches) break
      const line = lines[i] ?? ''
      if (line.toLowerCase().includes(needle)) {
        matches.push({ file, line: i + 1, text: line.slice(0, 500) })
      }
    }
  }
  return matches
}
