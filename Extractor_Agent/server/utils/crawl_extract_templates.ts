/**
 * 成功抽取模板沉淀：相似任务注入种子 URL / 字段 / 通道提示。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CrawlChannel } from './crawl_metrics'
import { normalizeTaskKey } from './crawl_learning'
import { getExtractorAgentEnv } from './extractor_agent_env'

export type ExtractTemplateEntry = {
  ts: string
  task_norm: string
  target_site: string
  content_type: string
  seed_url: string
  fields: string[]
  channel: CrawlChannel
  entity: string
  item_count: number
  hint: string
}

function dataDir() {
  const dir = join(process.cwd(), '.data')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function templatesFile() {
  return join(dataDir(), 'extractor-extract-templates.jsonl')
}

function tokenBag(text: string): Set<string> {
  const s = normalizeTaskKey(text)
  const parts = s.match(/[\u4e00-\u9fff]{2,}|[a-z0-9]{2,}/g) ?? []
  return new Set(parts.slice(0, 80))
}

function overlapScore(a: string, b: string): number {
  const ta = tokenBag(a)
  const tb = tokenBag(b)
  if (!ta.size || !tb.size) return 0
  let hit = 0
  for (const t of ta) if (tb.has(t)) hit++
  return hit / Math.max(ta.size, tb.size)
}

export function recordExtractTemplate(input: {
  task: string
  target_site?: string
  content_type?: string
  seed_url?: string
  fields?: string[]
  channel?: CrawlChannel
  entity?: string
  item_count?: number
}) {
  if (!getExtractorAgentEnv().enableExtractTemplates) return
  const seed = String(input.seed_url ?? '').trim()
  if (!seed || !/^https?:\/\//i.test(seed)) return
  const fields = (input.fields ?? []).map((x) => String(x).trim()).filter(Boolean).slice(0, 12)
  if (!fields.length) return
  const row: ExtractTemplateEntry = {
    ts: new Date().toISOString(),
    task_norm: normalizeTaskKey(input.task),
    target_site: String(input.target_site ?? 'generic'),
    content_type: String(input.content_type ?? 'generic'),
    seed_url: seed,
    fields,
    channel: input.channel ?? 'unknown',
    entity: String(input.entity ?? 'item'),
    item_count: Number(input.item_count ?? 0),
    hint: `站点=${input.target_site ?? 'generic'}；种子=${seed}；字段=${fields.join(',')}；通道=${input.channel ?? 'unknown'}`,
  }
  try {
    appendFileSync(templatesFile(), `${JSON.stringify(row)}\n`, 'utf8')
  } catch {
    /* ignore */
  }
}

export function readExtractTemplates(max = 300): ExtractTemplateEntry[] {
  const file = templatesFile()
  if (!existsSync(file)) return []
  try {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean)
    const out: ExtractTemplateEntry[] = []
    for (const line of lines.slice(-max)) {
      try {
        out.push(JSON.parse(line) as ExtractTemplateEntry)
      } catch {
        /* skip */
      }
    }
    return out
  } catch {
    return []
  }
}

export function recallSimilarExtractTemplates(task: string, targetSite?: string, limit = 2): ExtractTemplateEntry[] {
  if (!getExtractorAgentEnv().enableExtractTemplates) return []
  const templates = readExtractTemplates()
  const site = String(targetSite ?? '').trim()
  const scored = templates
    .map((t) => {
      let score = overlapScore(task, t.task_norm)
      if (site && t.target_site === site) score += 0.25
      return { t, score }
    })
    .filter((x) => x.score >= 0.35)
    .sort((a, b) => b.score - a.score)
  const seen = new Set<string>()
  const out: ExtractTemplateEntry[] = []
  for (const { t } of scored) {
    const k = `${t.seed_url}|${t.fields.join(',')}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push(t)
    if (out.length >= limit) break
  }
  return out
}

/** 高置信模板命中：优先规则抽取，跳过 LLM */
export function findHighConfidenceTemplate(
  task: string,
  targetSite?: string,
  minScore = 0.48,
): { template: ExtractTemplateEntry; score: number } | null {
  if (!getExtractorAgentEnv().enableExtractTemplates) return null
  const templates = readExtractTemplates()
  const site = String(targetSite ?? '').trim()
  let best: { template: ExtractTemplateEntry; score: number } | null = null
  for (const t of templates) {
    let score = overlapScore(task, t.task_norm)
    if (site && t.target_site === site) score += 0.28
    if (score < minScore) continue
    if (!best || score > best.score) best = { template: t, score }
  }
  return best
}

export function buildExtractTemplateBlock(task: string, targetSite?: string, contentType?: string): string {
  const hits = recallSimilarExtractTemplates(task, targetSite, 2)
  if (!hits.length) return ''
  const lines = hits.map((h, i) => `${i + 1}. ${h.hint}`)
  return [`[抽取模板回放] 相似任务曾成功：`, ...lines].join('\n').slice(0, 520)
}

export function getExtractTemplateSummary() {
  const rows = readExtractTemplates(500)
  const bySite: Record<string, number> = {}
  for (const r of rows) {
    const s = r.target_site || 'generic'
    bySite[s] = (bySite[s] || 0) + 1
  }
  return { total: rows.length, bySite, recent: rows.slice(-5).map((r) => r.hint.slice(0, 100)) }
}

function templateDedupeKey(t: ExtractTemplateEntry) {
  return `${t.target_site}|${t.seed_url}|${[...t.fields].sort().join(',')}`
}

function rewriteExtractTemplates(rows: ExtractTemplateEntry[]) {
  try {
    writeFileSync(templatesFile(), rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
  } catch {
    /* ignore */
  }
}

export function dedupeExtractTemplates() {
  const all = readExtractTemplates(500)
  const byKey = new Map<string, ExtractTemplateEntry>()
  for (const t of all) {
    const k = templateDedupeKey(t)
    const prev = byKey.get(k)
    if (!prev || Number(t.item_count ?? 0) > Number(prev.item_count ?? 0)) byKey.set(k, t)
  }
  const merged = Array.from(byKey.values()).sort((a, b) => String(b.ts).localeCompare(String(a.ts)))
  rewriteExtractTemplates(merged)
  return { before: all.length, after: merged.length }
}
