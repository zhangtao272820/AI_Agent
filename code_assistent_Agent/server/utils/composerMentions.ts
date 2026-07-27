/**
 * 从用户输入解析 @file / @folder 提及（P2-B3）
 */

export type MentionParseResult = {
  cleanMessage: string
  hintFiles: string[]
  hintFolders: string[]
}

const FILE_MENTION_RE = /@file:([^\s@]+)/gi
const FOLDER_MENTION_RE = /@folder:([^\s@]+)/gi
const SHORT_FILE_RE = /@([^\s@]+\.(?:ts|tsx|js|jsx|vue|py|json|md|yaml|yml|css|scss|mjs|cjs))/gi

export function parseComposerMentions(message: string): MentionParseResult {
  const hintFiles = new Set<string>()
  const hintFolders = new Set<string>()
  const raw = String(message || '')

  for (const re of [FILE_MENTION_RE, SHORT_FILE_RE]) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(raw)) !== null) {
      const p = String(m[1] || '').trim().replace(/\\/g, '/').replace(/^\.\//, '')
      if (p) hintFiles.add(p)
    }
  }

  FOLDER_MENTION_RE.lastIndex = 0
  let fm: RegExpExecArray | null
  while ((fm = FOLDER_MENTION_RE.exec(raw)) !== null) {
    const p = String(fm[1] || '').trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '')
    if (p) hintFolders.add(p)
  }

  let clean = raw
    .replace(FILE_MENTION_RE, '')
    .replace(SHORT_FILE_RE, '')
    .replace(FOLDER_MENTION_RE, '')
    .replace(/\s{2,}/g, ' ')
    .trim()

  return {
    cleanMessage: clean || raw.trim(),
    hintFiles: [...hintFiles],
    hintFolders: [...hintFolders],
  }
}
