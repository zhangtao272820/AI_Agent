/**
 * Lightweight PPTX text extraction (ZIP + slide XML, no extra dependency).
 */

const SLIDE_PATH = /^ppt\/slides\/slide(\d+)\.xml$/i
const TEXT_NODE = /<a:t[^>]*>([^<]*)<\/a:t>/g

function decodeXmlEntities(text: string): string {
  return String(text || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

function extractTextFromSlideXml(xml: string): string {
  const parts: string[] = []
  for (const m of String(xml || '').matchAll(TEXT_NODE)) {
    const t = decodeXmlEntities(String(m[1] ?? '')).trim()
    if (t) parts.push(t)
  }
  return parts.join(' ')
}

/** Extract plain text from .pptx buffer; returns empty string if no slides. */
export async function extractPptxText(buffer: Buffer): Promise<string> {
  const magic = buffer.slice(0, 4).toString('hex')
  if (magic !== '504b0304') {
    throw new Error('Invalid .pptx file: expected ZIP (pptx) format')
  }
  const AdmZip = (await import('adm-zip')).default
  const zip = new AdmZip(buffer)
  const slides: Array<{ n: number; text: string }> = []
  for (const entry of zip.getEntries()) {
    const m = SLIDE_PATH.exec(entry.entryName)
    if (!entry.isDirectory && m) {
      const n = Number(m[1]) || slides.length + 1
      const text = extractTextFromSlideXml(entry.getData().toString('utf8'))
      if (text.trim()) slides.push({ n, text: text.trim() })
    }
  }
  slides.sort((a, b) => a.n - b.n)
  if (!slides.length) return ''
  return slides.map((s) => `Slide ${s.n}: ${s.text}`).join('\n\n')
}

export function isLegacyPptOle(buffer: Buffer): boolean {
  return buffer.slice(0, 4).toString('hex') === 'd0cf11e0'
}
