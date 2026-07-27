export function compactStepInput(input: string, max = 260) {
  const s = String(input || '').replace(/\s+/g, ' ').trim()
  return s.length > max ? `${s.slice(0, max)}…` : s
}

export function buildAgentContext(context: string) {
  const raw = String(context || '').trim()
  if (!raw) return ''
  const chunks = raw
    .split(/\n\n+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => compactStepInput(x, 220))
  return chunks.slice(0, 3).join(' | ')
}
