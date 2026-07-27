/** 功能灰度：子串/数值判断，不用正则 */

export function sessionBucket(sessionId: string): number {
  const sid = String(sessionId || '').trim()
  if (!sid) return 50
  let h = 0
  for (let i = 0; i < sid.length; i++) {
    h = (Math.imul(31, h) + sid.charCodeAt(i)) >>> 0
  }
  return h % 100
}

export function parseRolloutPct(envName: string, fallback: number): number {
  const raw = String(process.env[envName] ?? '').trim()
  if (!raw) return Math.max(0, Math.min(100, fallback))
  const n = Number(raw)
  if (!Number.isFinite(n)) return Math.max(0, Math.min(100, fallback))
  return Math.max(0, Math.min(100, Math.floor(n)))
}

/** sessionId 稳定分桶；pct=100 全开，0 全关 */
export function rolloutHit(pctEnvName: string, sessionId: string | undefined, defaultPct: number): boolean {
  const pct = parseRolloutPct(pctEnvName, defaultPct)
  if (pct <= 0) return false
  if (pct >= 100) return true
  const sid = String(sessionId || '').trim()
  if (!sid) return false
  return sessionBucket(sid) < pct
}
