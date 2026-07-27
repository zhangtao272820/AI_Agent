/**
 * Lightweight HTML → plain text for RAG ingestion (no extra dependency).
 */

const BLOCK_TAGS = /<\/?(?:p|div|br|hr|h[1-6]|li|tr|table|thead|tbody|section|article|header|footer|blockquote|pre)\b[^>]*>/gi
const SCRIPT_STYLE = /<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>/gi
const ANY_TAG = /<[^>]+>/g

const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'"
}

function decodeBasicEntities(text: string): string {
  let out = String(text || '')
  for (const [entity, ch] of Object.entries(ENTITIES)) {
    out = out.split(entity).join(ch)
  }
  return out.replace(/&#(\d+);/g, (_, n) => {
    const code = Number(n)
    return Number.isFinite(code) ? String.fromCharCode(code) : _
  })
}

/** Strip HTML tags and collapse whitespace for vector indexing. */
export function stripHtmlToPlainText(html: string): string {
  let text = String(html || '')
  if (!text.trim()) return ''
  text = text.replace(SCRIPT_STYLE, ' ')
  text = text.replace(BLOCK_TAGS, '\n')
  text = text.replace(ANY_TAG, ' ')
  text = decodeBasicEntities(text)
  text = text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
  return text.trim()
}

export function looksLikeHtmlDocument(buffer: Buffer, fileName: string): boolean {
  const ext = String(fileName.split('.').pop() || '').toLowerCase()
  if (ext === 'html' || ext === 'htm') return true
  const head = buffer.slice(0, 512).toString('utf-8').toLowerCase()
  return head.includes('<html') || head.includes('<!doctype html')
}
