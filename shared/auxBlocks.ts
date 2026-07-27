export const AUX_BLOCK_TAGS = ['ECHARTS_OPTION', 'TABLE_DATA', 'REPORT', 'CRAWLER_TABLE'] as const
export type AuxBlockTag = (typeof AUX_BLOCK_TAGS)[number]

export function extractAuxBlocksStructural(text: string): {
  narrative: string
  blocks: Map<AuxBlockTag, string>
} {
  let narrative = String(text ?? '')
  const blocks = new Map<AuxBlockTag, string>()
  for (const tag of AUX_BLOCK_TAGS) {
    const open = `<!--${tag}-->`
    const close = `<!--/${tag}-->`
    let searchFrom = 0
    while (searchFrom < narrative.length) {
      const start = narrative.indexOf(open, searchFrom)
      if (start < 0) break
      const end = narrative.indexOf(close, start + open.length)
      if (end < 0) break
      const full = narrative.slice(start, end + close.length).trim()
      blocks.set(tag, full)
      narrative = `${narrative.slice(0, start)}${narrative.slice(end + close.length)}`.trim()
      searchFrom = Math.max(0, start)
    }
  }
  return { narrative: narrative.trim(), blocks }
}

export function mergeMissingAuxBlocksFrom(base: string, donor: string): string {
  let out = String(base ?? '').trim()
  const donorBlocks = extractAuxBlocksStructural(donor).blocks
  for (const tag of AUX_BLOCK_TAGS) {
    const block = donorBlocks.get(tag)
    if (!block) continue
    if (out.includes(`<!--${tag}-->`)) continue
    out = `${out}\n\n${block}`.trim()
  }
  return out
}

/** 取更长的叙事正文，并合并两侧附属块（流式预览 vs 落盘 final 对齐） */
export function pickRicherNarrativeWithAuxBlocks(primary: string, secondary: string): string {
  const a = extractAuxBlocksStructural(String(primary ?? ''))
  const b = extractAuxBlocksStructural(String(secondary ?? ''))
  let narrative = a.narrative.trim()
  const bNarr = b.narrative.trim()
  if (!narrative) narrative = bNarr
  else if (bNarr.length > narrative.length * 1.05) narrative = bNarr
  else if (narrative.length < bNarr.length * 0.85 && bNarr.length > 0) narrative = bNarr
  let out = narrative.trim()
  for (const tag of AUX_BLOCK_TAGS) {
    const block = b.blocks.get(tag) || a.blocks.get(tag)
    if (!block) continue
    if (out.includes(`<!--${tag}-->`)) continue
    out = `${out}\n\n${block}`.trim()
  }
  return out
}
