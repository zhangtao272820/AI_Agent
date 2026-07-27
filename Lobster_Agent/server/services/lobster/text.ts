export function sanitize(text: string) {
  return String(text || '')
    .replace(/sk-[A-Za-z0-9]{12,}/g, 'sk-***')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer ***')
}

export function clipForPrompt(text: string, maxChars: number) {
  const s = String(text || '').trim()
  const n = Number.isFinite(maxChars) && maxChars > 200 ? Math.floor(maxChars) : 1800
  if (s.length <= n) return s
  const head = Math.max(400, Math.floor(n * 0.65))
  const tail = Math.max(200, n - head)
  return `${s.slice(0, head)}\n…\n${s.slice(Math.max(0, s.length - tail))}`
}
