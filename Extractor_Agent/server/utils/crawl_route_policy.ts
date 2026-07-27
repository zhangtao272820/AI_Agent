/**
 * 通道路由策略：站点画像 + Bandit 偏好 + 学习信号，为每次抓取选择更优通道。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CrawlChannel } from './crawl_metrics'
import type { CrawlLearningSignal } from './crawl_learning'
import { signalsFile } from './crawl_learning'
import { getExtractorAgentEnv } from './extractor_agent_env'
import { channelForFailureTag, inferFailureTagsFromRun, primaryFailureTag } from './crawl_failure_tags'

export type RouteDecision = {
  preferBrowser: boolean
  preferMcp: boolean
  reason: string
  learnedChannel?: CrawlChannel
  confidence: number
  contextKey: string
  channelScores: Partial<Record<CrawlChannel, number>>
}

type ChannelPreferenceRow = {
  contextKey: string
  channel: CrawlChannel
  trials: number
  successes: number
  empty: number
  avgMs: number
}

type RoutePreferencesFile = {
  updatedAt: string
  rows: ChannelPreferenceRow[]
}

function dataDir() {
  const dir = join(process.cwd(), '.data')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function prefsFile() {
  return join(dataDir(), 'extractor-route-preferences.json')
}

export function buildRouteContextKey(input: {
  targetSite?: string
  contentType?: string
  antiBotRisk?: 'low' | 'medium' | 'high'
}): string {
  const site = String(input.targetSite ?? 'generic').trim() || 'generic'
  const ct = String(input.contentType ?? 'generic').trim() || 'generic'
  const risk = String(input.antiBotRisk ?? 'low').trim() || 'low'
  return `${site}:${ct}:${risk}`
}

function readPrefs(): RoutePreferencesFile {
  const file = prefsFile()
  if (!existsSync(file)) return { updatedAt: new Date().toISOString(), rows: [] }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as RoutePreferencesFile
    if (!parsed || !Array.isArray(parsed.rows)) return { updatedAt: new Date().toISOString(), rows: [] }
    return parsed
  } catch {
    return { updatedAt: new Date().toISOString(), rows: [] }
  }
}

function channelToBrowser(ch: CrawlChannel): boolean {
  return ch === 'browser' || ch === 'mcp'
}

function scoreRow(row: ChannelPreferenceRow): number {
  if (row.trials <= 0) return 0
  const winRate = row.successes / row.trials
  const emptyPenalty = row.empty / row.trials
  const exploration = Math.sqrt(2 * Math.log(Math.max(row.trials, 2)) / row.trials)
  return winRate - emptyPenalty * 0.35 + exploration * 0.08
}

export function pickChannelFromBandit(contextKey: string, minTrials = 2): RouteDecision | null {
  if (!getExtractorAgentEnv().enableRoutePolicy) return null
  const file = readPrefs()
  const rows = file.rows.filter((r) => r.contextKey === contextKey && r.trials >= minTrials)
  if (!rows.length) return null

  const channelScores: Partial<Record<CrawlChannel, number>> = {}
  let best: { ch: CrawlChannel; score: number; row: ChannelPreferenceRow } | null = null
  for (const row of rows) {
    const s = scoreRow(row)
    channelScores[row.channel] = s
    if (!best || s > best.score) best = { ch: row.channel, score: s, row }
  }
  if (!best || best.score < 0.25) return null

  const winRate = best.row.trials ? best.row.successes / best.row.trials : 0
  return {
    preferBrowser: channelToBrowser(best.ch),
    preferMcp: best.ch === 'mcp',
    reason: `bandit_${best.ch}`,
    learnedChannel: best.ch,
    confidence: Math.min(0.95, winRate),
    contextKey,
    channelScores,
  }
}

function readRecentSignals(max = 400): CrawlLearningSignal[] {
  const file = signalsFile()
  if (!existsSync(file)) return []
  try {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean)
    const out: CrawlLearningSignal[] = []
    for (const line of lines.slice(-max)) {
      try {
        out.push(JSON.parse(line) as CrawlLearningSignal)
      } catch {
        /* skip */
      }
    }
    return out
  } catch {
    return []
  }
}

export function channelWinRatesBySite(targetSite?: string): Record<string, { wins: number; total: number }> {
  const site = String(targetSite ?? 'generic').trim() || 'generic'
  const stats: Record<string, { wins: number; total: number }> = {}
  for (const sig of readRecentSignals()) {
    if (sig.feedback != null) continue
    if ((sig.target_site || 'generic') !== site) continue
    const ch = sig.channel || 'unknown'
    if (!stats[ch]) stats[ch] = { wins: 0, total: 0 }
    stats[ch].total++
    if (sig.ok && sig.quality_passed !== false && !sig.empty) stats[ch].wins++
  }
  return stats
}

function suggestChannelFromSignals(targetSite?: string, minSamples = 3): RouteDecision | null {
  if (!getExtractorAgentEnv().enableCrawlLearning) return null
  const rates = channelWinRatesBySite(targetSite)
  let best: { ch: CrawlChannel; rate: number; total: number } | null = null
  for (const [ch, v] of Object.entries(rates)) {
    if (!v || v.total < minSamples) continue
    const rate = v.wins / v.total
    if (!best || rate > best.rate) best = { ch: ch as CrawlChannel, rate, total: v.total }
  }
  if (!best || best.rate < 0.45) return null
  return {
    preferBrowser: channelToBrowser(best.ch),
    preferMcp: best.ch === 'mcp',
    reason: `learned_channel_${best.ch}`,
    learnedChannel: best.ch,
    confidence: Math.min(0.95, best.rate),
    contextKey: buildRouteContextKey({ targetSite }),
    channelScores: { [best.ch]: best.rate },
  }
}

/** 综合 Bandit 偏好与近期信号，供 decideExecutionStrategy 调用。 */
export function resolveChannelPolicy(input: {
  targetSite?: string
  contentType?: string
  antiBotRisk?: 'low' | 'medium' | 'high'
  lastFailureTags?: string[]
}): RouteDecision | null {
  const contextKey = buildRouteContextKey(input)
  const bandit = pickChannelFromBandit(contextKey, getExtractorAgentEnv().routeBanditMinTrials)
  if (bandit && bandit.confidence >= 0.4) return bandit

  const signal = suggestChannelFromSignals(input.targetSite)
  if (signal) return { ...signal, contextKey }

  const tag = primaryFailureTag((input.lastFailureTags ?? []) as any)
  const ch = channelForFailureTag(tag)
  if (ch) {
    return {
      preferBrowser: channelToBrowser(ch),
      preferMcp: ch === 'mcp',
      reason: `failure_tag_${tag}`,
      learnedChannel: ch,
      confidence: 0.5,
      contextKey,
      channelScores: { [ch]: 0.5 },
    }
  }
  return null
}

export function recordChannelOutcome(input: {
  contextKey: string
  channel: CrawlChannel
  ok: boolean
  empty?: boolean
  ms?: number
}) {
  if (!getExtractorAgentEnv().enableRoutePolicy) return
  const file = readPrefs()
  const rowKey = `${input.contextKey}|${input.channel}`
  let row = file.rows.find((r) => `${r.contextKey}|${r.channel}` === rowKey)
  if (!row) {
    row = { contextKey: input.contextKey, channel: input.channel, trials: 0, successes: 0, empty: 0, avgMs: 0 }
    file.rows.push(row)
  }
  row.trials += 1
  if (input.ok && !input.empty) row.successes += 1
  if (input.empty) row.empty += 1
  if (input.ms) row.avgMs = row.avgMs ? (row.avgMs + input.ms) / 2 : input.ms
  file.updatedAt = new Date().toISOString()
  try {
    writeFileSync(prefsFile(), JSON.stringify(file, null, 2), 'utf8')
  } catch {
    /* ignore */
  }
}

export function recordChannelOutcomeFromRun(result: any, ms?: number) {
  const tp = result?.taskPlan ?? {}
  const pre = result?.preflight ?? {}
  const contextKey = buildRouteContextKey({
    targetSite: tp.targetSite,
    contentType: tp.contentType,
    antiBotRisk: pre.antiBotRisk,
  })
  const channel = (result?.meta?.primary_channel ?? 'unknown') as CrawlChannel
  const status = String(result?.status ?? '')
  const items = Array.isArray(result?.items) ? result.items : []
  recordChannelOutcome({
    contextKey,
    channel,
    ok: status === 'ok' || status === 'partial_ok',
    empty: items.length === 0 && status !== 'needs_clarification',
    ms,
  })
}

export function getRoutePreferencesSummary() {
  const file = readPrefs()
  const byChannel: Record<string, { trials: number; successes: number; empty: number }> = {}
  for (const r of file.rows) {
    const k = r.channel
    if (!byChannel[k]) byChannel[k] = { trials: 0, successes: 0, empty: 0 }
    byChannel[k].trials += r.trials
    byChannel[k].successes += r.successes
    byChannel[k].empty += r.empty
  }
  return { updatedAt: file.updatedAt, rowCount: file.rows.length, byChannel }
}

export function clearRoutePreferences() {
  const file: RoutePreferencesFile = { updatedAt: new Date().toISOString(), rows: [] }
  try {
    writeFileSync(prefsFile(), JSON.stringify(file, null, 2), 'utf8')
  } catch {
    /* ignore */
  }
  return file
}

export function inferFailureTagsForMeta(result: any) {
  return inferFailureTagsFromRun(result)
}
