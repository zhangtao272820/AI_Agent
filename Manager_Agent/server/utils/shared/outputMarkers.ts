import { AUX_BLOCK_TAGS } from '#agent-shared/auxBlocks'
export { extractAuxBlocksStructural, mergeMissingAuxBlocksFrom } from '#agent-shared/auxBlocks'
export type { AuxBlockTag } from '#agent-shared/auxBlocks'

export function extractTaggedBlock(raw: string, tag: string): string | null {
  const t = String(tag || '').trim()
  if (!t) return null
  const re = new RegExp(`<!--\\s*${t}\\s*-->([\\s\\S]*?)<!--\\s*/\\s*${t}\\s*-->`, 'i')
  const m = String(raw || '').match(re)
  return m?.[1] != null ? String(m[1]).trim() : null
}

export function hasTaggedBlock(raw: string, tag: string): boolean {
  const t = String(tag || '').trim()
  if (!t) return false
  return new RegExp(`<!--\\s*${t}\\s*-->[\\s\\S]*?<!--\\s*/\\s*${t}\\s*-->`, 'i').test(String(raw || ''))
}

export function stripTaggedBlock(raw: string, tag: string): string {
  const t = String(tag || '').trim()
  if (!t) return String(raw || '')
  return String(raw || '')
    .replace(new RegExp(`<!--\\s*${t}\\s*-->[\\s\\S]*?<!--\\s*/\\s*${t}\\s*-->`, 'gi'), '')
    .trim()
}

export function wrapTaggedBlock(tag: string, body: string): string {
  return `<!--${tag}-->\n${String(body || '').trim()}\n<!--/${tag}-->`
}

/** 返回含开闭标签的完整块（与 synth 拼接逻辑一致） */
export function extractTaggedBlockFull(raw: string, tag: string): string {
  const t = String(raw || '')
  const re = new RegExp(`<!--\\s*${tag}\\s*-->[\\s\\S]*?<!--\\s*/\\s*${tag}\\s*-->`, 'i')
  const m = t.match(re)
  return m ? String(m[0] || '').trim() : ''
}

export function extractFirstBalancedJsonObject(raw: string): string {
  const s = String(raw || '')
  const start = s.indexOf('{')
  if (start < 0) return ''
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < s.length; i++) {
    const ch = s[i]
    if (inStr) {
      if (esc) {
        esc = false
        continue
      }
      if (ch === '\\') {
        esc = true
        continue
      }
      if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') {
      inStr = true
      continue
    }
    if (ch === '{') depth += 1
    if (ch === '}') {
      depth -= 1
      if (depth === 0) return s.slice(start, i + 1).trim()
    }
  }
  return ''
}

export function hasTaggedBlockPair(raw: string, tag: string): boolean {
  const t = String(tag || '').trim()
  if (!t) return false
  return new RegExp(`<!--\\s*${t}\\s*-->[\\s\\S]*?<!--\\s*/\\s*${t}\\s*-->`, 'i').test(String(raw || ''))
}
