/**
 * DB 路由档位：DB_ROUTE_MODE / DB_LEGACY_SHORTCUTS 替代 ENABLE_SCHEMA_FIRST_ROUTE 等 0/1。
 */

export type DbRouteMode = 'schema_first' | 'legacy'

export function resolveDbRouteMode(env: NodeJS.ProcessEnv = process.env): DbRouteMode {
  const raw = String(env.DB_ROUTE_MODE ?? '').trim().toLowerCase()
  if (raw === 'legacy' || raw === 'classic' || raw === 'keyword') return 'legacy'
  const explicit = env.ENABLE_SCHEMA_FIRST_ROUTE
  if (explicit !== undefined && String(explicit).trim() !== '') {
    return /^(0|false|off|no)$/i.test(String(explicit).trim()) ? 'legacy' : 'schema_first'
  }
  return 'schema_first'
}

export function isSchemaFirstRouteEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveDbRouteMode(env) === 'schema_first'
}

export function areDbLegacyShortcutsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const mode = String(env.DB_LEGACY_SHORTCUTS ?? '').trim().toLowerCase()
  if (mode === 'on' || mode === '1' || mode === 'enabled') return true
  if (mode === 'off' || mode === '0' || mode === 'disabled') return false
  const skills = env.ENABLE_DOMAIN_SKILLS
  const metrics = env.ENABLE_METRICS_DIRECT
  if (skills !== undefined || metrics !== undefined) {
    const sOn = skills === undefined || !/^(0|false|off|no)$/i.test(String(skills).trim())
    const mOn = metrics === undefined || !/^(0|false|off|no)$/i.test(String(metrics).trim())
    return sOn || mOn
  }
  return false
}
