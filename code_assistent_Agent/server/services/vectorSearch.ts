import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileSha256, getRoot, readText, walkFiles } from './fileSystem'

type EmbeddingsLike = {
  embedDocuments(texts: string[]): Promise<number[][]>
  embedQuery(text: string): Promise<number[]>
}

type VectorIndexChunk = { startLine: number; endLine: number; vec: number[]; snippet: string }
type VectorIndexFile = { sha256: string; chunks: VectorIndexChunk[] }
type VectorIndex = { version: 1; root: string; embeddingModel: string; files: Record<string, VectorIndexFile> }
type VectorIndexState = { index: VectorIndex; dirty: boolean; writing: Promise<void> }

const vectorIndexCache = new Map<string, VectorIndexState>()

function safeRandomUUID() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.randomBytes(16)
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function cosineSimilarity(a: number[], b: number[]) {
  const n = Math.min(a.length, b.length)
  if (!n) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    dot += x * y
    na += x * x
    nb += y * y
  }
  if (na <= 0 || nb <= 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

function vectorIndexKey(params: { root: string; embeddingModel: string }) {
  return `${params.embeddingModel}::${params.root}`
}

function vectorIndexPath(key: string) {
  const hash = crypto.createHash('sha256').update(key).digest('hex').slice(0, 24)
  return path.join(process.cwd(), '.data', 'vector-index', `${hash}.json`)
}

async function loadVectorIndex(params: { root: string; embeddingModel: string }) {
  const key = vectorIndexKey(params)
  const existing = vectorIndexCache.get(key)
  if (existing) return { key, state: existing }

  const filePath = vectorIndexPath(key)
  const raw = await fs.readFile(filePath, 'utf8').catch(() => '')
  let index: VectorIndex | undefined
  if (raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as VectorIndex
      if (
        parsed &&
        parsed.version === 1 &&
        typeof parsed.root === 'string' &&
        typeof parsed.embeddingModel === 'string' &&
        typeof parsed.files === 'object'
      ) {
        index = parsed
      }
    } catch {}
  }
  if (!index) {
    index = { version: 1, root: params.root, embeddingModel: params.embeddingModel, files: {} }
  }
  const state: VectorIndexState = { index, dirty: false, writing: Promise.resolve() }
  vectorIndexCache.set(key, state)
  return { key, state }
}

async function saveVectorIndex(key: string, state: VectorIndexState) {
  if (!state.dirty) return
  const filePath = vectorIndexPath(key)
  state.dirty = false
  state.writing = state.writing
    .then(async () => {
      await fs.mkdir(path.dirname(filePath), { recursive: true }).catch(() => {})
      const tmp = `${filePath}.${safeRandomUUID()}.tmp`
      await fs.writeFile(tmp, JSON.stringify(state.index), 'utf8')
      await fs.rename(tmp, filePath).catch(async () => {
        await fs.writeFile(filePath, JSON.stringify(state.index), 'utf8')
        await fs.rm(tmp, { force: true }).catch(() => {})
      })
    })
    .catch(() => {})
  return state.writing
}

function tokenize(text: string) {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
}

function pickPreviewFromContent(content: string, tokens: string[], maxLineChars: number) {
  const lines = content.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    const l = line.toLowerCase()
    if (tokens.some((t) => l.includes(t))) {
      return `${i + 1}: ${line.slice(0, maxLineChars)}`
    }
  }
  const first = lines[0] ?? ''
  return `1: ${first.slice(0, maxLineChars)}`
}

export async function runVectorSearch(params: {
  embeddings: EmbeddingsLike
  embeddingModel: string
  query: string
  rootOverride?: string
  extensions?: string[] | null
  maxFiles: number
  maxCandidates: number
  maxResults: number
  maxCharsPerFile: number
  maxChunksPerFile: number
  overlapLines: number
  chunkChars: number
  maxSnippetChars: number
  maxPreviewChars: number
  refreshCache: boolean
}) {
  const rootOverride = params.rootOverride
  const files = await walkFiles({
    root: rootOverride,
    maxFiles: params.maxFiles,
    includeExtensions: params.extensions ?? null
  })

  const stop = new Set([
    'the',
    'and',
    'or',
    'to',
    'of',
    'in',
    'on',
    'for',
    'with',
    'is',
    'are',
    'a',
    'an',
    'as',
    'at',
    'by',
    'from'
  ])
  const tokens = Array.from(new Set(tokenize(params.query))).filter((t) => !stop.has(t))

  const ranked = files
    .map((file) => {
      const lower = file.toLowerCase()
      let score = 0
      for (const t of tokens) {
        if (lower.includes(t)) score += 1
      }
      return { file, score }
    })
    .sort((a, b) => b.score - a.score)

  const candidates = ranked.slice(0, Math.min(params.maxCandidates, ranked.length)).map((x) => x.file)

  const rootAbs = getRoot(rootOverride)
  const { key, state } = await loadVectorIndex({ root: rootAbs, embeddingModel: params.embeddingModel })
  const index = state.index

  function chunkText(text: string) {
    const lines = text.split(/\r?\n/)
    const chunks: Array<{ startLine: number; endLine: number; snippet: string }> = []
    let i = 0
    while (i < lines.length && chunks.length < params.maxChunksPerFile) {
      let j = i
      let chars = 0
      while (j < lines.length) {
        const next = lines[j] ?? ''
        const add = next.length + 1
        if (chars > 0 && chars + add > params.chunkChars) break
        chars += add
        j += 1
      }
      if (j <= i) j = Math.min(lines.length, i + 1)
      const snippet = lines.slice(i, j).join('\n')
      chunks.push({ startLine: i + 1, endLine: j, snippet })
      if (j >= lines.length) break
      i = Math.max(j - params.overlapLines, i + 1)
    }
    return chunks
  }

  for (const file of candidates) {
    let sha = ''
    try {
      const meta = await fileSha256(file, rootOverride)
      sha = meta.sha256
    } catch {
      continue
    }
    const existing = index.files[file]
    if (!params.refreshCache && existing && existing.sha256 === sha && existing.chunks?.length) {
      continue
    }
    let content = ''
    try {
      content = await readText(file, params.maxCharsPerFile, rootOverride)
    } catch {
      continue
    }
    const chunks = chunkText(content)
    if (!chunks.length) continue
    const vecs = await params.embeddings.embedDocuments(chunks.map((c) => c.snippet))
    const packed: VectorIndexChunk[] = chunks.map((c, idx) => ({
      startLine: c.startLine,
      endLine: c.endLine,
      vec: vecs[idx] ?? [],
      snippet: c.snippet.slice(0, params.maxSnippetChars)
    }))
    index.files[file] = { sha256: sha, chunks: packed }
    state.dirty = true
  }
  await saveVectorIndex(key, state)

  const queryVec = await params.embeddings.embedQuery(params.query)
  const results: Array<{ file: string; score: number; range: string; preview: string }> = []
  for (const file of candidates) {
    const entry = index.files[file]
    if (!entry?.chunks?.length) continue
    let best = -1
    let bestChunk: VectorIndexChunk | null = null
    for (const ch of entry.chunks) {
      const s = cosineSimilarity(queryVec, ch.vec)
      if (s > best) {
        best = s
        bestChunk = ch
      }
    }
    if (!bestChunk) continue
    results.push({
      file,
      score: Number(best.toFixed(4)),
      range: `${bestChunk.startLine}-${bestChunk.endLine}`,
      preview: pickPreviewFromContent(bestChunk.snippet, tokens, params.maxPreviewChars)
    })
  }
  results.sort((a, b) => b.score - a.score)

  return { query: params.query, model: params.embeddingModel, results: results.slice(0, params.maxResults) }
}
