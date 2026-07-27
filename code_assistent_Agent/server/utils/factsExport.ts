/**
 * 跨 Agent facts → CSV 导出（P1 exports / script 模式）
 */
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { StructuredUpstreamFact } from './manager_task'

export type ExportFactsResult = {
  ok: boolean
  path?: string
  rows: number
  error?: string
}

function exportsDir() {
  const dir = join(process.cwd(), '.data', 'exports')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function csvEscape(v: unknown): string {
  const s = String(v ?? '')
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function slugName(input: string): string {
  return String(input || 'facts')
    .trim()
    .slice(0, 48)
    .replace(/[^\w\u4e00-\u9fff-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'facts'
}

export function factsToCsv(facts: StructuredUpstreamFact[]): string {
  const header = 'key,value,source,agent'
  const rows = facts.map((f) =>
    [f.key, f.value, f.source ?? '', f.agent ?? ''].map(csvEscape).join(','),
  )
  return [header, ...rows].join('\n')
}

export function exportFactsToCsv(input: {
  facts: StructuredUpstreamFact[]
  name?: string
  appendAudit?: boolean
}): ExportFactsResult {
  const facts = Array.isArray(input.facts) ? input.facts.filter((f) => f && f.key) : []
  if (!facts.length) return { ok: false, rows: 0, error: 'no facts' }

  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const base = slugName(input.name ?? 'manager_facts')
  const rel = `.data/exports/${base}_${ts}.csv`
  const abs = join(exportsDir(), `${base}_${ts}.csv`)
  const csv = factsToCsv(facts)

  try {
    writeFileSync(abs, csv, 'utf8')
    if (input.appendAudit !== false) {
      appendFileSync(join(process.cwd(), '.data', 'exports-index.jsonl'), `${JSON.stringify({ ts: new Date().toISOString(), path: rel, rows: facts.length })}\n`)
    }
    return { ok: true, path: rel, rows: facts.length }
  } catch (e: unknown) {
    return { ok: false, rows: 0, error: String((e as Error)?.message ?? e) }
  }
}

export function shouldAutoExportFacts(input: {
  taskKind: string
  question?: string
  facts?: StructuredUpstreamFact[]
  enabled: boolean
}): boolean {
  if (!input.enabled || !input.facts?.length) return false
  const q = String(input.question || '').toLowerCase()
  if (input.taskKind === 'script') return true
  return /export|csv|导出|写入.*csv/.test(q)
}
