/**
 * PG 日备调度封装（供 autonomy 插件 / ops 调用）
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolveAgentDatabaseUrl } from './storageBackend'

const __sharedDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__sharedDir, '..')

export function isPgDailyBackupEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.MGR_PG_DAILY_BACKUP ?? '1').trim() !== '0'
}

function stamp() {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

export async function runPgDailyBackup(env: NodeJS.ProcessEnv = process.env): Promise<{
  ok: boolean
  file?: string
  sizeKb?: number
  error?: string
}> {
  const outDir = path.join(repoRoot, 'backups')
  await fs.mkdir(outDir, { recursive: true })
  const outFile = path.join(outDir, `agent-memory-${stamp()}.sql`)
  const container = String(env.CLAWHIVE_PG_CONTAINER || 'clawhive_postgres').trim()

  const url = resolveAgentDatabaseUrl(env)
  if (url) {
    try {
      const u = new URL(url.replace(/^postgresql\+psycopg2:/, 'postgresql:'))
      const r = spawnSync(
        'pg_dump',
        [
          '-h',
          u.hostname || 'localhost',
          '-p',
          u.port || '5432',
          '-U',
          decodeURIComponent(u.username || 'postgres'),
          '-d',
          u.pathname.replace(/^\//, '') || 'clawhive',
          '-f',
          outFile
        ],
        {
          env: { ...env, PGPASSWORD: u.password ? decodeURIComponent(u.password) : 'postgres' },
          stdio: 'pipe',
          shell: process.platform === 'win32'
        }
      )
      if (r.status === 0) {
        const stat = await fs.stat(outFile)
        return { ok: true, file: outFile, sizeKb: Math.round(stat.size / 1024) }
      }
    } catch {
      /* docker fallback */
    }
  }

  const sql = spawnSync('docker', ['exec', container, 'pg_dump', '-U', 'postgres', '-d', 'clawhive'], {
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024
  })
  if (sql.status !== 0 || !sql.stdout) {
    return { ok: false, error: String(sql.stderr || 'docker pg_dump failed') }
  }
  await fs.writeFile(outFile, sql.stdout, 'utf8')
  const stat = await fs.stat(outFile)
  return { ok: true, file: outFile, sizeKb: Math.round(stat.size / 1024) }
}
