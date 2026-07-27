/**
 * P6 用户偏好：跨请求沉淀常用站点、数量、输出格式，注入 plan/slot 阶段。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getExtractorAgentEnv } from './extractor_agent_env'

export type ExtractorUserPreferences = {
  updated_at: string
  crawl_count?: number
  preferred_target_site?: string
  preferred_content_type?: string
  default_limit?: number
  preferred_output_format?: 'json' | 'csv' | 'markdown'
  preferred_channel?: string
  frequent_sites?: string[]
  frequent_fields?: string[]
}

const GLOBAL_KEY = '__global__'

function prefsFile() {
  const dir = join(process.cwd(), '.data')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'extractor-user-preferences.json')
}

function loadAll(): Record<string, ExtractorUserPreferences> {
  const p = prefsFile()
  if (!existsSync(p)) return {}
  try {
    const o = JSON.parse(readFileSync(p, 'utf8')) as Record<string, ExtractorUserPreferences>
    return o && typeof o === 'object' ? o : {}
  } catch {
    return {}
  }
}

function saveAll(store: Record<string, ExtractorUserPreferences>) {
  writeFileSync(prefsFile(), JSON.stringify(store, null, 2), 'utf8')
}

function clipText(s: string, max: number) {
  const t = String(s ?? '').trim()
  return t.length > max ? t.slice(0, max) : t
}

export function normalizeSessionKey(key?: string) {
  const k = String(key ?? '').trim().slice(0, 64)
  return k || GLOBAL_KEY
}

export function getUserPreferences(sessionKey?: string): ExtractorUserPreferences {
  if (!getExtractorAgentEnv().enableUserPreferences) return { updated_at: '', crawl_count: 0 }
  const store = loadAll()
  return store[normalizeSessionKey(sessionKey)] ?? { updated_at: '', crawl_count: 0 }
}

export function learnFromSuccessfulCrawl(input: {
  sessionKey?: string
  task: string
  target_site?: string
  content_type?: string
  limit?: number
  fields?: string[]
  channel?: string
  output_format?: string
}) {
  if (!getExtractorAgentEnv().enableUserPreferences) return
  const key = normalizeSessionKey(input.sessionKey)
  const store = loadAll()
  const prev = store[key] ?? { updated_at: '', crawl_count: 0 }

  const site = String(input.target_site ?? '').trim()
  const contentType = String(input.content_type ?? '').trim()
  const limit = Number(input.limit ?? NaN)
  const fields = (input.fields ?? []).map((x) => String(x).trim()).filter(Boolean).slice(0, 8)
  const channel = String(input.channel ?? '').trim()
  const fmt = String(input.output_format ?? '').trim().toLowerCase()

  const frequent_sites = Array.from(
    new Set([...(prev.frequent_sites ?? []), ...(site && site !== 'generic' ? [site] : [])]),
  ).slice(-6)
  const frequent_fields = Array.from(new Set([...(prev.frequent_fields ?? []), ...fields])).slice(-10)

  store[key] = {
    updated_at: new Date().toISOString(),
    crawl_count: (prev.crawl_count ?? 0) + 1,
    preferred_target_site: site && site !== 'generic' ? site : prev.preferred_target_site,
    preferred_content_type: contentType && contentType !== 'generic' ? contentType : prev.preferred_content_type,
    default_limit: Number.isFinite(limit) && limit > 0 ? Math.min(250, Math.floor(limit)) : prev.default_limit,
    preferred_output_format:
      fmt === 'json' || fmt === 'csv' || fmt === 'markdown'
        ? fmt
        : prev.preferred_output_format,
    preferred_channel: channel && channel !== 'unknown' ? channel : prev.preferred_channel,
    frequent_sites: frequent_sites.length ? frequent_sites : prev.frequent_sites,
    frequent_fields: frequent_fields.length ? frequent_fields : prev.frequent_fields,
  }
  saveAll(store)
}

export function formatUserPreferencesBlock(sessionKey?: string): string {
  if (!getExtractorAgentEnv().enableUserPreferences) return ''
  const p = getUserPreferences(sessionKey)
  const lines: string[] = []
  if (p.preferred_target_site) lines.push(`- 常用站点：${p.preferred_target_site}`)
  if (p.preferred_content_type && p.preferred_content_type !== 'generic') {
    lines.push(`- 常抓类型：${p.preferred_content_type}`)
  }
  if (Number.isFinite(Number(p.default_limit)) && Number(p.default_limit) > 0) {
    lines.push(`- 常设数量：${p.default_limit}`)
  }
  if (p.preferred_output_format) lines.push(`- 偏好输出：${p.preferred_output_format}`)
  if (p.preferred_channel && p.preferred_channel !== 'unknown') {
    lines.push(`- 偏好通道：${p.preferred_channel}`)
  }
  if (p.frequent_sites?.length) lines.push(`- 近期站点：${p.frequent_sites.slice(0, 4).join('、')}`)
  if (p.frequent_fields?.length) lines.push(`- 常取字段：${p.frequent_fields.slice(0, 6).join('、')}`)
  if (!lines.length) return ''
  return clipText(
    `[用户偏好]（历史口径参考，本句有明确条件时以本句为准）\n${lines.join('\n')}`,
    getExtractorAgentEnv().experienceBlockMaxChars,
  )
}

export function getUserPreferencesSummary() {
  const store = loadAll()
  const keys = Object.keys(store)
  return { sessionCount: keys.length, global: store[GLOBAL_KEY] ?? null }
}

export function clearUserPreferences() {
  try {
    writeFileSync(prefsFile(), '{}', 'utf8')
  } catch {
    /* ignore */
  }
}
