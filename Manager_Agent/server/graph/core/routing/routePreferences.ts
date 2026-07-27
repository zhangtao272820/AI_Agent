import fs from 'node:fs/promises'
import path from 'node:path'
import { readSignals } from '../unifiedLearning'
import { isEvolutionRoutingHintEnabled } from '../evolution/evolutionRoutingGate'

export type RoutePreferenceEntry = {
  intent: string
  sampleCount: number
  avgComposite: number
  avgSuccess: number
  penalty: number
}

export type RoutePreferences = {
  updatedAt: string
  entries: RoutePreferenceEntry[]
  deprioritize: string[]
}

const PREFS_FILE = 'manager-route-preferences.json'

export function isRoutePreferenceLearnEnabled(env: NodeJS.ProcessEnv = process.env) {
  if (!isEvolutionRoutingHintEnabled(env)) return false
  return String(env.MANAGER_ROUTE_PREFERENCE_LEARN ?? '1').trim() !== '0'
}

function prefsPath(policyDir: string) {
  return path.join(policyDir, PREFS_FILE)
}

export async function loadRoutePreferences(policyDir: string): Promise<RoutePreferences | null> {
  try {
    const raw = await fs.readFile(prefsPath(policyDir), 'utf8')
    return JSON.parse(raw) as RoutePreferences
  } catch {
    return null
  }
}

/** 从 learning-signals 离线汇总 intent 偏好（自治插件周期调用） */
export async function maybeRefreshRoutePreferences(policyDir: string): Promise<{ updated: boolean; prefs?: RoutePreferences }> {
  if (!isRoutePreferenceLearnEnabled()) return { updated: false }

  const signals = await readSignals(policyDir, 300)
  if (signals.length < 8) return { updated: false }

  const byIntent: Record<string, { composite: number[]; success: number[] }> = {}
  for (const s of signals) {
    const intent = String(s.intent || 'unknown').trim()
    if (!byIntent[intent]) byIntent[intent] = { composite: [], success: [] }
    if (Number.isFinite(s.compositeScore)) byIntent[intent].composite.push(s.compositeScore)
    if (Number.isFinite(s.successScore)) byIntent[intent].success.push(s.successScore)
  }

  const entries: RoutePreferenceEntry[] = []
  const deprioritize: string[] = []

  for (const [intent, bucket] of Object.entries(byIntent)) {
    if (bucket.composite.length < 3) continue
    const avgComposite = bucket.composite.reduce((a, b) => a + b, 0) / bucket.composite.length
    const avgSuccess = bucket.success.length
      ? bucket.success.reduce((a, b) => a + b, 0) / bucket.success.length
      : avgComposite
    let penalty = 0
    if (avgComposite < 0.48 && bucket.composite.length >= 4) penalty = 0.35
    else if (avgComposite < 0.55 && bucket.composite.length >= 3) penalty = 0.18
    entries.push({
      intent,
      sampleCount: bucket.composite.length,
      avgComposite: Math.round(avgComposite * 1000) / 1000,
      avgSuccess: Math.round(avgSuccess * 1000) / 1000,
      penalty
    })
    if (penalty >= 0.18 && !['multi', 'report'].includes(intent)) deprioritize.push(intent)
  }

  entries.sort((a, b) => a.avgComposite - b.avgComposite)

  const prefs: RoutePreferences = {
    updatedAt: new Date().toISOString(),
    entries: entries.slice(0, 16),
    deprioritize: [...new Set(deprioritize)].slice(0, 6)
  }

  await fs.mkdir(policyDir, { recursive: true }).catch(() => undefined)
  await fs.writeFile(prefsPath(policyDir), JSON.stringify(prefs, null, 2), 'utf8')
  return { updated: true, prefs }
}

export function formatRoutePreferencesBlock(prefs: RoutePreferences | null): string {
  if (!prefs?.deprioritize?.length) return ''
  const lines = prefs.entries
    .filter((e) => e.penalty > 0)
    .slice(0, 4)
    .map((e) => `- ${e.intent}：近期均分 ${e.avgComposite}（${e.sampleCount} 条）→ 非必要不优先`)
  if (!lines.length) return ''
  return ['【可学习路由偏好（来自 learning-signals 离线汇总）】', ...lines].join('\n')
}
