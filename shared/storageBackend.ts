/**
 * 存储后端抽象：file | postgres | dual
 * dual：写 PG+文件，读 PG 优先、失败回退文件。
 */

export type StorageBackend = 'file' | 'postgres' | 'dual'

export function resolveStorageBackend(
  envValue: string | undefined,
  fallback: StorageBackend = 'file'
): StorageBackend {
  const raw = String(envValue ?? '').trim().toLowerCase()
  if (raw === 'postgres' || raw === 'pg') return 'postgres'
  if (raw === 'dual') return 'dual'
  if (raw === 'file') return 'file'
  return fallback
}

export function isPostgresStorageEnabled(backend: StorageBackend): boolean {
  return backend === 'postgres' || backend === 'dual'
}

export function shouldWriteFile(backend: StorageBackend): boolean {
  return backend === 'file' || backend === 'dual'
}

export function shouldWritePostgres(backend: StorageBackend): boolean {
  return backend === 'postgres' || backend === 'dual'
}

export function resolveAgentDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return String(
    env.AGENT_DATABASE_URL ||
      env.CLAWHIVE_DATABASE_URL ||
      env.DATABASE_URL ||
      ''
  ).trim()
}
