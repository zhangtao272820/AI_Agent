import { agentPgQuery } from './agentPgClient'
import {
  isPostgresStorageEnabled,
  resolveStorageBackend,
  shouldWriteFile,
  shouldWritePostgres
} from './storageBackend'

export type RouteStatRow = {
  contextKey: string
  path: string
  trials: number
  successes: number
  empty: number
  avgMs: number
}

export function resolveDbRouteStorageBackend(env: NodeJS.ProcessEnv = process.env) {
  return resolveStorageBackend(env.DB_AGENT_STORAGE_BACKEND, 'file')
}

let routeCache: RouteStatRow[] | null = null

export async function hydrateDbRouteStatsCache(): Promise<void> {
  const res = await agentPgQuery<{
    context_key: string
    path: string
    trials: number
    successes: number
    empty_count: number
    avg_ms: number
  }>(`SELECT context_key, path, trials, successes, empty_count, avg_ms FROM db_route_stats`)
  if (!res) {
    routeCache = []
    return
  }
  routeCache = res.rows.map((r) => ({
    contextKey: r.context_key,
    path: r.path,
    trials: r.trials,
    successes: r.successes,
    empty: r.empty_count,
    avgMs: r.avg_ms
  }))
}

export function readDbRouteStatsSync(): RouteStatRow[] {
  if (routeCache) return [...routeCache]
  return []
}

export async function upsertDbRouteStat(row: RouteStatRow): Promise<void> {
  const backend = resolveDbRouteStorageBackend()
  if (shouldWritePostgres(backend)) {
    await agentPgQuery(
      `INSERT INTO db_route_stats (context_key, path, trials, successes, empty_count, avg_ms, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW())
       ON CONFLICT (context_key, path) DO UPDATE SET
         trials = EXCLUDED.trials,
         successes = EXCLUDED.successes,
         empty_count = EXCLUDED.empty_count,
         avg_ms = EXCLUDED.avg_ms,
         updated_at = NOW()`,
      [row.contextKey, row.path, row.trials, row.successes, row.empty, row.avgMs]
    )
  }
  if (!routeCache) routeCache = []
  const key = `${row.contextKey}|${row.path}`
  const idx = routeCache.findIndex((r) => `${r.contextKey}|${r.path}` === key)
  if (idx >= 0) routeCache[idx] = row
  else routeCache.push(row)
}

export async function replaceDbRouteStats(rows: RouteStatRow[]): Promise<void> {
  const backend = resolveDbRouteStorageBackend()
  if (shouldWritePostgres(backend)) {
    await agentPgQuery(`DELETE FROM db_route_stats`)
    for (const row of rows) {
      await upsertDbRouteStat(row)
    }
    routeCache = [...rows]
    return
  }
  routeCache = [...rows]
}

export async function clearDbRouteStats(): Promise<void> {
  const backend = resolveDbRouteStorageBackend()
  if (shouldWritePostgres(backend)) {
    await agentPgQuery(`DELETE FROM db_route_stats`)
  }
  routeCache = []
}

export function shouldUseDbRoutePg(): boolean {
  return isPostgresStorageEnabled(resolveDbRouteStorageBackend())
}
