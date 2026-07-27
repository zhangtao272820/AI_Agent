/**
 * 采集经验回放：相似任务注入成功路径提示（站点/通道/种子/字段）。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CrawlChannel } from './crawl_metrics'
import { normalizeTaskKey } from './crawl_learning'
import { getExtractorAgentEnv } from './extractor_agent_env'
import { getPromptPatchesForStage } from './prompt_evolution'
import { formatUserPreferencesBlock } from './user_preferences'
import { recallByVectorSimilarity, type EmbeddingClientConfig } from './experience_vectors'

export type CrawlExperienceEntry = {
  ts: string
  task_norm: string
  target_site?: string
  content_type?: string
  channel?: CrawlChannel
  seed_url?: string
  fields?: string[]
  hint: string
}

export type CrawlInjectBlocks = {
  plan: string
  slot: string
  extract: string
  experience: string
}

function dataDir() {
  const dir = join(process.cwd(), '.data')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function experienceFile() {
  return join(dataDir(), 'extractor-crawl-experience.jsonl')
}

function clipText(s: string, max: number) {
  const t = String(s ?? '').trim()
  return t.length > max ? t.slice(0, max) : t
}

function readJsonl<T>(file: string, max = 400): T[] {
  if (!existsSync(file)) return []
  try {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean)
    const out: T[] = []
    for (const line of lines.slice(-max)) {
      try {
        out.push(JSON.parse(line) as T)
      } catch {
        /* skip */
      }
    }
    return out
  } catch {
    return []
  }
}

function overlapScore(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1
  if (a.includes(b) || b.includes(a)) return 0.85
  const ta = new Set(a.match(/[\u4e00-\u9fff]{2,}|[a-z0-9]{2,}/g) ?? [])
  const tb = new Set(b.match(/[\u4e00-\u9fff]{2,}|[a-z0-9]{2,}/g) ?? [])
  if (!ta.size || !tb.size) return 0
  let hit = 0
  for (const t of ta) if (tb.has(t)) hit++
  return hit / Math.max(ta.size, tb.size)
}

export function buildExperienceHint(input: {
  target_site?: string
  content_type?: string
  channel?: CrawlChannel
  seed_url?: string
  fields?: string[]
}): string {
  const parts: string[] = []
  if (input.target_site) parts.push(`站点=${input.target_site}`)
  if (input.content_type) parts.push(`类型=${input.content_type}`)
  if (input.channel) parts.push(`通道=${input.channel}`)
  if (input.seed_url) parts.push(`种子=${input.seed_url}`)
  if (input.fields?.length) parts.push(`字段=${input.fields.join('、')}`)
  return parts.join('；')
}

export function recordCrawlExperience(input: {
  task: string
  target_site?: string
  content_type?: string
  channel?: CrawlChannel
  seed_url?: string
  fields?: string[]
}) {
  if (!getExtractorAgentEnv().enableExperienceReplay) return
  const hint = buildExperienceHint(input)
  if (!hint) return
  const row: CrawlExperienceEntry = {
    ts: new Date().toISOString(),
    task_norm: normalizeTaskKey(input.task),
    target_site: input.target_site,
    content_type: input.content_type,
    channel: input.channel,
    seed_url: input.seed_url,
    fields: input.fields,
    hint,
  }
  try {
    appendFileSync(experienceFile(), `${JSON.stringify(row)}\n`, 'utf8')
  } catch {
    /* ignore */
  }
}

export function recallSimilarExperience(task: string, limit = 3): CrawlExperienceEntry[] {
  if (!getExtractorAgentEnv().enableExperienceReplay) return []
  const key = normalizeTaskKey(task)
  if (!key) return []
  const all = readJsonl<CrawlExperienceEntry>(experienceFile(), 500)
  const scored = all
    .map((e) => ({ e, s: overlapScore(key, e.task_norm) }))
    .filter((x) => x.s >= 0.42)
    .sort((a, b) => b.s - a.s)
  const seen = new Set<string>()
  const hits: CrawlExperienceEntry[] = []
  for (const { e } of scored) {
    const k = `${e.hint}|${e.seed_url ?? ''}`
    if (seen.has(k)) continue
    seen.add(k)
    hits.push(e)
    if (hits.length >= limit) break
  }
  return hits
}

/** 将经验回放中的成功通道/种子转为运行时路由提示（需 EXTRACTOR_ENABLE_EXPERIENCE_REPLAY） */
export function resolveExperienceRoutingHint(task: string): {
  preferred_channel?: 'http' | 'browser' | 'mcp'
  seed_url?: string
} | null {
  const hit = recallSimilarExperience(task, 1)[0]
  if (!hit) return null
  const ch = String(hit.channel ?? '').trim() as 'http' | 'browser' | 'mcp'
  const preferred_channel = ch === 'http' || ch === 'browser' || ch === 'mcp' ? ch : undefined
  const seed_url = String(hit.seed_url ?? '').trim()
  if (!preferred_channel && !seed_url) return null
  return {
    ...(preferred_channel ? { preferred_channel } : {}),
    ...(seed_url.startsWith('http') ? { seed_url } : {})
  }
}

export function buildExperienceBlock(task: string, extraHits?: CrawlExperienceEntry[]): string {
  const ngramHits = recallSimilarExperience(task, 2)
  const merged: CrawlExperienceEntry[] = []
  const seen = new Set<string>()
  for (const h of [...(extraHits ?? []), ...ngramHits]) {
    const k = `${h.hint}|${h.seed_url ?? ''}`
    if (seen.has(k)) continue
    seen.add(k)
    merged.push(h)
    if (merged.length >= 2) break
  }
  if (!merged.length) return ''
  const lines = merged.map((h, i) => `${i + 1}. ${h.hint}`)
  return clipText(
    `[经验回放]（仅供参考；与当前任务条件不一致时必须忽略，以当前任务为准）\n${lines.join('\n')}`,
    getExtractorAgentEnv().experienceBlockMaxChars
  )
}

export function buildCrawlInjectBlocks(task: string, sessionKey?: string): CrawlInjectBlocks {
  const prefs = formatUserPreferencesBlock(sessionKey)
  const experience = buildExperienceBlock(task)
  const combined = [experience, prefs].filter(Boolean).join('\n')
  return {
    experience: combined,
    plan: [combined, getPromptPatchesForStage('plan')].filter(Boolean).join('\n'),
    slot: [prefs, getPromptPatchesForStage('slot')].filter(Boolean).join('\n'),
    extract: getPromptPatchesForStage('extract'),
  }
}

export async function buildCrawlInjectBlocksAsync(
  task: string,
  sessionKey?: string,
  embeddingConfig?: EmbeddingClientConfig,
): Promise<CrawlInjectBlocks> {
  const env = getExtractorAgentEnv()
  const prefs = formatUserPreferencesBlock(sessionKey)
  const ngramHits = recallSimilarExperience(task, 2)
  const ngramStrong = ngramHits.length > 0

  let vectorHits: CrawlExperienceEntry[] = []
  if (
    embeddingConfig?.apiKey &&
    env.enableVectorExperience &&
    (!env.vectorRecallOnlyWhenNgramWeak || !ngramStrong)
  ) {
    vectorHits = await recallByVectorSimilarity(task, embeddingConfig, 2)
  }

  const experience = buildExperienceBlock(task, vectorHits)
  const combined = [experience, prefs].filter(Boolean).join('\n')
  return {
    experience: combined,
    plan: [combined, getPromptPatchesForStage('plan')].filter(Boolean).join('\n'),
    slot: [prefs, getPromptPatchesForStage('slot')].filter(Boolean).join('\n'),
    extract: getPromptPatchesForStage('extract'),
  }
}

export function getExperienceSummary() {
  const rows = readJsonl<CrawlExperienceEntry>(experienceFile(), 500)
  const bySite: Record<string, number> = {}
  for (const r of rows) {
    const s = r.target_site || 'generic'
    bySite[s] = (bySite[s] || 0) + 1
  }
  return { total: rows.length, bySite, recent: rows.slice(-4).map((r) => r.hint.slice(0, 100)) }
}

export function clearExperience() {
  try {
    writeFileSync(experienceFile(), '', 'utf8')
  } catch {
    /* ignore */
  }
}