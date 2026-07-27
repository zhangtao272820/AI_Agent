/**
 * Prompt 卫生 SSOT（§12）：runtime prompt / skill 晋升禁止 golden 专名。
 * denylist 以 JSON import 打进 bundle，避免 Nitro 运行时 ENOENT。
 */
import denylistJson from './promptHygieneDenylist.json'

let denylistCache: string[] | null = null

export function loadPromptHygieneDenylist(): string[] {
  if (denylistCache) return denylistCache
  denylistCache = Array.isArray(denylistJson) ? (denylistJson as string[]) : []
  return denylistCache
}

export function findPromptHygieneViolations(text: string, tokens = loadPromptHygieneDenylist()): string[] {
  const s = String(text ?? '')
  const hits: string[] = []
  for (const token of tokens) {
    if (token.length < 3) continue
    if (s.includes(token)) hits.push(token)
  }
  return hits
}

export function assertPromptHygiene(text: string, context: string): void {
  const hits = findPromptHygieneViolations(text)
  if (hits.length) {
    throw new Error(`${context}: prompt hygiene violation (${hits.join(', ')})`)
  }
}
