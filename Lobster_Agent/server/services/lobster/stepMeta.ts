/** Step metadata sent to clients / logs: strip huge strings so terminals and WS stay usable. */

const DEFAULT_MAX = 480

function truncateKeyUsesShortLimit(k: string) {
  const key = k.toLowerCase()
  if (key.startsWith('pagetext')) return true
  if (key === 'toastafter' || key === 'text' || key === 'ocrtext' || key === 'visionsummary') return true
  if (/(^|_)(message|summary|reason)$/.test(key)) return true
  return false
}

function truncateString(s: string, max: number) {
  if (s.length <= max) return s
  return `${s.slice(0, max)}…`
}

export function sanitizeStepMetaForEmit(meta: any, maxStr = DEFAULT_MAX, depth = 4): any {
  if (meta == null) return meta
  if (depth <= 0) return '[depth]'
  if (typeof meta === 'string') {
    return meta.length > maxStr * 4 ? truncateString(meta, maxStr * 4) : meta
  }
  if (typeof meta !== 'object') return meta
  if (Array.isArray(meta)) {
    return meta.slice(0, 80).map((x) => sanitizeStepMetaForEmit(x, maxStr, depth - 1))
  }
  const out: Record<string, any> = {}
  for (const [k, v] of Object.entries(meta)) {
    if (typeof v === 'string') {
      const limit = truncateKeyUsesShortLimit(k) ? maxStr : Math.min(12_000, maxStr * 25)
      if (v.length > limit) {
        out[k] = truncateString(v, limit)
        out[`${k}Len`] = v.length
      } else {
        out[k] = v
      }
    } else if (v && typeof v === 'object') {
      out[k] = sanitizeStepMetaForEmit(v, maxStr, depth - 1)
    } else {
      out[k] = v
    }
  }
  return out
}
