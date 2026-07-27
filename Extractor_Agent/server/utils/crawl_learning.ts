/**
 * 采集学习闭环：运行信号与用户反馈落盘，供后续经验回放 / 通道 Bandit 使用。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CrawlChannel } from './crawl_metrics'
import { getExtractorAgentEnv } from './extractor_agent_env'

export type CrawlLearningSignal = {
  ts: string
  task: string
  task_norm: string
  target_site?: string
  content_type?: string
  channel?: CrawlChannel
  ok: boolean
  empty?: boolean
  quality_passed?: boolean
  retry_triggered?: boolean
  status?: string
  ms?: number
  feedback?: number
  comment?: string
  source?: string
}

function dataDir() {
  const dir = join(process.cwd(), '.data')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function signalsFile() {
  return join(dataDir(), 'extractor-learning-signals.jsonl')
}

export function normalizeTaskKey(task: string): string {
  return String(task ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[，,。.;；:：!?？]/g, '')
    .slice(0, 120)
}

function readJsonlLines<T>(file: string, maxLines?: number): T[] {
  const cap = maxLines ?? getExtractorAgentEnv().learningSignalsMaxRead
  if (!existsSync(file)) return []
  try {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean)
    const out: T[] = []
    for (const line of lines.slice(-cap)) {
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

export function readLearningSignals(maxLines?: number): CrawlLearningSignal[] {
  return readJsonlLines<CrawlLearningSignal>(signalsFile(), maxLines)
}

export function recordLearningSignal(sig: Omit<CrawlLearningSignal, 'ts' | 'task_norm'> & { task: string }) {
  const row: CrawlLearningSignal = {
    ...sig,
    ts: new Date().toISOString(),
    task_norm: normalizeTaskKey(sig.task),
  }
  try {
    appendFileSync(signalsFile(), `${JSON.stringify(row)}\n`, 'utf8')
  } catch {
    /* ignore */
  }
}

export function recordRunLearningSignal(params: {
  task: string
  result: any
  ms: number
  source?: string
}) {
  if (!getExtractorAgentEnv().enableCrawlLearning) return
  const r = params.result ?? {}
  const tp = r.taskPlan ?? {}
  const status = String(r.status ?? '')
  const items = Array.isArray(r.items) ? r.items : []
  const ok = status === 'ok' || status === 'partial_ok'
  recordLearningSignal({
    task: params.task,
    target_site: tp.targetSite ? String(tp.targetSite) : undefined,
    content_type: tp.contentType ? String(tp.contentType) : undefined,
    channel: r.meta?.primary_channel,
    ok,
    empty: items.length === 0 && status !== 'needs_clarification',
    quality_passed: r.quality?.passed,
    retry_triggered: Boolean(r.retry?.triggered),
    status,
    ms: params.ms,
    source: params.source,
  })
}

export function recordFeedbackSignal(params: {
  task: string
  score: number
  comment?: string
  target_site?: string
  channel?: CrawlChannel
  source?: string
}) {
  recordLearningSignal({
    task: params.task,
    target_site: params.target_site,
    channel: params.channel,
    ok: params.score > 0,
    feedback: params.score,
    comment: params.comment,
    source: params.source || 'feedback',
  })
}

export function getLearningSummary() {
  const signals = readJsonlLines<CrawlLearningSignal>(signalsFile())
  let runs = 0
  let feedback = 0
  let positive = 0
  let negative = 0
  let clarify = 0
  let empty = 0
  const bySite: Record<string, number> = {}
  const byChannel: Record<string, number> = {}

  for (const s of signals) {
    if (s.feedback != null) {
      feedback++
      if (s.feedback > 0) positive++
      else negative++
      continue
    }
    runs++
    if (s.status === 'needs_clarification') clarify++
    if (s.empty) empty++
    const site = s.target_site || 'generic'
    bySite[site] = (bySite[site] || 0) + 1
    const ch = s.channel || 'unknown'
    byChannel[ch] = (byChannel[ch] || 0) + 1
  }

  return {
    totalSignals: signals.length,
    runSignals: runs,
    feedbackSignals: feedback,
    positiveFeedback: positive,
    negativeFeedback: negative,
    clarificationCount: clarify,
    emptyResultCount: empty,
    bySite,
    byChannel,
    recentTasks: signals
      .filter((s) => !s.feedback)
      .slice(-8)
      .map((s) => ({ task: s.task.slice(0, 80), status: s.status, site: s.target_site })),
  }
}
