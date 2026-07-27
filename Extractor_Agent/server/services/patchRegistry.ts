/**
 * 站点补丁注册表：从 patches/sites|domains/*.json 加载。
 * 换站只加 JSON，Core TS 不变。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { TargetSite, ContentType } from './capabilityRegistry'

export type SitePatchListSelectors = {
  item: string
  title?: string
  url?: string
  rank?: string
  excerpt?: string
}

export type SitePatch = {
  id: string
  targetSite?: TargetSite
  contentType?: ContentType
  defaultSeedUrls?: string[]
  preferChannel?: 'http' | 'browser' | 'mcp'
  antiBotRisk?: 'low' | 'medium' | 'high'
  apiSeedUrl?: string
  builtinHandler?: string
  matchHostSuffix?: string[]
  listSelectors?: SitePatchListSelectors
  articleSelectors?: string[]
}

export type CapabilityProfile = {
  targetSite: TargetSite
  contentType: ContentType
  defaultSeedUrls: string[]
  preferChannel: 'http' | 'browser' | 'mcp'
  antiBotRisk: 'low' | 'medium' | 'high'
  patchId: string
  apiSeedUrl?: string
  builtinHandler?: string
  listSelectors?: SitePatchListSelectors
  articleSelectors?: string[]
}

const FALLBACK: SitePatch[] = [
  { id: 'douban.ranking', targetSite: 'douban', contentType: 'ranking', defaultSeedUrls: ['https://movie.douban.com/top250'], preferChannel: 'http', antiBotRisk: 'low', builtinHandler: 'douban_top250' },
  { id: 'zhihu.ranking', targetSite: 'zhihu', contentType: 'ranking', defaultSeedUrls: ['https://www.zhihu.com/hot'], preferChannel: 'browser', antiBotRisk: 'medium', apiSeedUrl: 'https://www.zhihu.com/api/v3/feed/topstory/hot-lists/total' },
  { id: 'weibo.ranking', targetSite: 'weibo', contentType: 'ranking', defaultSeedUrls: ['https://s.weibo.com/top/summary?cate=realtimehot'], preferChannel: 'http', antiBotRisk: 'medium' },
  { id: 'bilibili.ranking', targetSite: 'bilibili', contentType: 'ranking', defaultSeedUrls: ['https://www.bilibili.com/v/popular/rank/all'], preferChannel: 'browser', antiBotRisk: 'medium', apiSeedUrl: 'https://api.bilibili.com/x/web-interface/ranking/v2?rid=0&type=all' },
  { id: 'toutiao.ranking', targetSite: 'toutiao', contentType: 'ranking', defaultSeedUrls: ['https://www.toutiao.com/hot-event/hot-board/'], preferChannel: 'http', antiBotRisk: 'medium' },
  { id: 'douyin.ranking', targetSite: 'douyin', contentType: 'ranking', defaultSeedUrls: ['https://www.douyin.com/hot?tab=hot'], preferChannel: 'browser', antiBotRisk: 'high' },
  { id: 'jd.products', targetSite: 'jd', contentType: 'products', defaultSeedUrls: ['https://www.jd.com/phb/key_9987fe5edeab9a4a8355.html'], preferChannel: 'mcp', antiBotRisk: 'high' },
]

let cached: { at: number; patches: SitePatch[]; byKey: Map<string, SitePatch> } | null = null

function patchesRoot() {
  const fromEnv = String(process.env.EXTRACTOR_PATCHES_DIR ?? '').trim()
  if (fromEnv && existsSync(fromEnv)) return fromEnv
  const cwd = join(process.cwd(), 'patches')
  if (existsSync(cwd)) return cwd
  return join(process.cwd(), 'Extractor_Agent', 'patches')
}

function readJsonFile(file: string): SitePatch | null {
  try {
    const raw = readFileSync(file, 'utf8')
    const obj = JSON.parse(raw) as SitePatch
    if (!obj || typeof obj !== 'object' || !String(obj.id ?? '').trim()) return null
    return { ...obj, id: String(obj.id).trim() }
  } catch {
    return null
  }
}

function loadJsonPatches(dir: string): SitePatch[] {
  if (!existsSync(dir)) return []
  const out: SitePatch[] = []
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue
    const p = readJsonFile(join(dir, name))
    if (p) out.push(p)
  }
  return out
}

function mergePatches(base: SitePatch[], extra: SitePatch[]): SitePatch[] {
  const byId = new Map<string, SitePatch>()
  for (const p of base) byId.set(p.id, p)
  for (const p of extra) byId.set(p.id, { ...byId.get(p.id), ...p })
  return [...byId.values()]
}

function loadAllPatches(): { patches: SitePatch[]; byKey: Map<string, SitePatch> } {
  const root = patchesRoot()
  const fromDisk = [
    ...loadJsonPatches(join(root, 'sites')),
    ...loadJsonPatches(join(root, 'domains')),
  ]
  const merged = mergePatches(FALLBACK, fromDisk)
  const byKey = new Map<string, SitePatch>()
  for (const p of merged) {
    if (p.targetSite && p.contentType) {
      byKey.set(`${p.targetSite}:${p.contentType}`, p)
    }
    byKey.set(p.id, p)
  }
  return { patches: merged, byKey }
}

export function getSitePatches(): SitePatch[] {
  const now = Date.now()
  if (cached && now - cached.at < 10_000) return cached.patches
  const loaded = loadAllPatches()
  cached = { at: now, ...loaded }
  return loaded.patches
}

function toProfile(patch: SitePatch): CapabilityProfile | null {
  if (!patch.targetSite || !patch.contentType) return null
  return {
    targetSite: patch.targetSite,
    contentType: patch.contentType,
    defaultSeedUrls: (patch.defaultSeedUrls ?? []).slice(0, 5),
    preferChannel: patch.preferChannel ?? 'http',
    antiBotRisk: patch.antiBotRisk ?? 'low',
    patchId: patch.id,
    apiSeedUrl: patch.apiSeedUrl,
    builtinHandler: patch.builtinHandler,
    listSelectors: patch.listSelectors,
    articleSelectors: patch.articleSelectors,
  }
}

export function getCapabilityProfile(targetSite: TargetSite, contentType: ContentType): CapabilityProfile | null {
  getSitePatches()
  const hit = cached?.byKey.get(`${targetSite}:${contentType}`)
  return hit ? toProfile(hit) : null
}

export function getPatchAntiBotRisk(targetSite: TargetSite, contentType: ContentType): 'low' | 'medium' | 'high' {
  return getCapabilityProfile(targetSite, contentType)?.antiBotRisk ?? 'low'
}

export function resolvePatchByUrl(url: string): SitePatch | null {
  getSitePatches()
  let host = ''
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
  if (!host) return null
  for (const p of cached?.patches ?? []) {
    const suffixes = p.matchHostSuffix ?? []
    if (!suffixes.length) continue
    if (suffixes.some((s) => host === s || host.endsWith(`.${s}`) || host.endsWith(s))) return p
  }
  return null
}

export function resolvePatchForTask(targetSite?: string, contentType?: string, url?: string): SitePatch | null {
  if (targetSite && contentType) {
    getSitePatches()
    const hit = cached?.byKey.get(`${targetSite}:${contentType}`)
    if (hit) return hit
  }
  if (url) return resolvePatchByUrl(url)
  return null
}

export function listPatchSummary() {
  return getSitePatches().map((p) => ({
    id: p.id,
    targetSite: p.targetSite ?? null,
    contentType: p.contentType ?? null,
    preferChannel: p.preferChannel ?? 'http',
    hasListSelectors: Boolean(p.listSelectors?.item),
    hasArticleSelectors: Boolean(p.articleSelectors?.length),
  }))
}
