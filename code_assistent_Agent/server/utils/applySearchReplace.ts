/**
 * Aider 式 SEARCH/REPLACE 块解析与应用（P2-B2）
 */

export type SearchReplaceBlock = {
  path?: string
  search: string
  replace: string
}

const BLOCK_RE =
  /<<<<<<<\s*SEARCH\s*\r?\n([\s\S]*?)\r?\n=======\r?\n([\s\S]*?)\r?\n>>>>>>>\s*REPLACE/g

/** 从文本中解析一个或多个 SEARCH/REPLACE 块；可选首行 path */
export function parseSearchReplaceBlocks(text: string, defaultPath?: string): SearchReplaceBlock[] {
  const raw = String(text ?? '')
  const blocks: SearchReplaceBlock[] = []
  let m: RegExpExecArray | null
  BLOCK_RE.lastIndex = 0
  while ((m = BLOCK_RE.exec(raw)) !== null) {
    blocks.push({
      path: defaultPath,
      search: m[1] ?? '',
      replace: m[2] ?? '',
    })
  }
  if (blocks.length) return blocks

  // 单块无 path 前缀时整段即 blocks
  const single = raw.match(BLOCK_RE)
  if (single) return blocks

  return blocks
}

/** 解析带「path 行 + 块」的多文件格式 */
export function parseSearchReplaceDocument(text: string): SearchReplaceBlock[] {
  const lines = String(text ?? '').split(/\r?\n/)
  const blocks: SearchReplaceBlock[] = []
  let currentPath: string | undefined
  let buf: string[] = []

  const flush = () => {
    if (!buf.length) return
    const chunk = buf.join('\n')
    buf = []
    const parsed = parseSearchReplaceBlocks(chunk, currentPath)
    for (const b of parsed) {
      blocks.push({ ...b, path: b.path || currentPath })
    }
  }

  for (const line of lines) {
    if (/^<<<<<<<\s*SEARCH/.test(line)) {
      flush()
      buf = [line]
      continue
    }
    if (buf.length) {
      buf.push(line)
      if (/^>>>>>>>\s*REPLACE/.test(line)) {
        const chunk = buf.join('\n')
        buf = []
        const parsed = parseSearchReplaceBlocks(chunk, currentPath)
        for (const b of parsed) {
          blocks.push({ ...b, path: b.path || currentPath })
        }
      }
      continue
    }
    if (/\.(ts|tsx|js|jsx|vue|py|json|md|yaml|yml|css|scss)$/i.test(line.trim()) && !line.includes(' ')) {
      currentPath = line.trim()
    }
  }
  flush()
  return blocks
}

function normalizeNewlines(s: string) {
  return s.replace(/\r\n/g, '\n')
}

/** 对单文件内容应用一个 SEARCH/REPLACE 块 */
export function applySingleSearchReplace(content: string, search: string, replace: string): string {
  const src = normalizeNewlines(content)
  const needle = normalizeNewlines(search)
  const repl = normalizeNewlines(replace)
  const idx = src.indexOf(needle)
  if (idx < 0) {
    throw new Error('SEARCH block not found in file (context mismatch)')
  }
  const second = src.indexOf(needle, idx + needle.length)
  if (second >= 0) {
    throw new Error('SEARCH block is ambiguous (multiple matches)')
  }
  return src.slice(0, idx) + repl + src.slice(idx + needle.length)
}

/** 对单文件依次应用多个块 */
export function applySearchReplaceToContent(content: string, blocks: SearchReplaceBlock[]): string {
  let out = content
  for (const b of blocks) {
    out = applySingleSearchReplace(out, b.search, b.replace)
  }
  return out
}

/** 解析并应用到指定文件内容 */
export function applySearchReplaceOrThrow(oldContent: string, blocksText: string, filePath?: string): string {
  const blocks = parseSearchReplaceDocument(blocksText)
  const scoped = filePath
    ? blocks.filter((b) => !b.path || b.path === filePath || b.path.endsWith(filePath))
    : blocks
  const use = scoped.length ? scoped : parseSearchReplaceBlocks(blocksText, filePath)
  if (!use.length) {
    throw new Error('No SEARCH/REPLACE blocks found')
  }
  return applySearchReplaceToContent(oldContent, use)
}
