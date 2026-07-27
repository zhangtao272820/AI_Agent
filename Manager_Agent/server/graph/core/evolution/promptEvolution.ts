import fs from 'node:fs/promises'
import path from 'node:path'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import type { FailureInsightBundle } from './failureInsights'
import {
  loadActivePromptPatches,
  loadShadowPromptPatches,
  promoteShadowPromptPatches,
  writeShadowPromptPatches,
  type PromptPatchSet
} from './promptPatches'
import { isEvolutionRoutingHintEnabled } from './evolutionRoutingGate'

const LAST_EVOLVE_FILE = 'manager-prompt-evolve-state.json'

export function isPromptEvolutionEnabled() {
  return String(process.env.MANAGER_PROMPT_EVOLVE ?? '1').trim() !== '0'
}

function evolveMinIntervalMs() {
  const n = Number(process.env.MANAGER_PROMPT_EVOLVE_MIN_INTERVAL_MS ?? 900_000)
  return Number.isFinite(n) && n >= 60_000 ? Math.min(86_400_000, Math.floor(n)) : 900_000
}

function autoPromoteEnabled() {
  return String(process.env.MANAGER_PROMPT_AUTO_PROMOTE ?? '0').trim() === '1'
}

async function readLastEvolveTs(policyDir: string): Promise<number> {
  try {
    const raw = await fs.readFile(path.join(policyDir, LAST_EVOLVE_FILE), 'utf8')
    const o = JSON.parse(raw)
    const t = Date.parse(String(o?.updatedAt || ''))
    return Number.isFinite(t) ? t : 0
  } catch {
    return 0
  }
}

async function writeLastEvolveTs(policyDir: string) {
  await fs.mkdir(policyDir, { recursive: true }).catch(() => undefined)
  await fs.writeFile(
    path.join(policyDir, LAST_EVOLVE_FILE),
    JSON.stringify({ updatedAt: new Date().toISOString() }),
    'utf8'
  )
}

function ruleBasedPatches(insights: FailureInsightBundle): PromptPatchSet | null {
  const suggestions = insights.fixSuggestions || []
  if (!suggestions.length) return null

  const router: string[] = []
  const planner: string[] = []
  for (const b of suggestions.slice(0, 5)) {
    for (const s of b.suggestions.slice(0, 2)) {
      const line = `${s.title}：${s.action}`.replace(/\s+/g, ' ').trim().slice(0, 160)
      if (!line) continue
      if (s.scope === 'router' && router.length < 4 && isEvolutionRoutingHintEnabled()) router.push(line)
      if (s.scope === 'planner' && planner.length < 4) planner.push(line)
      if (s.scope === 'memory' && router.length < 4 && isEvolutionRoutingHintEnabled()) router.push(`记忆避雷：${line}`)
    }
  }
  if (!router.length && !planner.length) return null

  const top = insights.failures[0]
  const rationale = insights.strongestSignals.join('；') || top?.category || 'failure_cluster'
  const confidence = Math.min(
    0.92,
    0.55 +
      Math.min(0.2, (insights.samples || 0) / 80) +
      (top && top.count >= 3 ? 0.12 : 0) +
      (suggestions.length >= 2 ? 0.08 : 0)
  )

  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    active: true,
    source: 'auto',
    confidence,
    rationale: `规则归纳：${rationale}`,
    router: { append: router },
    planner: { append: planner }
  }
}

async function llmPatches(
  insights: FailureInsightBundle,
  llmInvoke: (stage: 'critic', state: any, messages: any[]) => Promise<{ text: string }>
): Promise<PromptPatchSet | null> {
  const bundles = (insights.fixSuggestions || []).slice(0, 4)
  if (!bundles.length) return null

  const summary = bundles
    .map(
      (b) =>
        `[${b.category}/${b.severity}] ` +
        b.suggestions.map((s) => `${s.scope}: ${s.title} — ${s.action}`).join(' | ')
    )
    .join('\n')

  const prompt = [
    new SystemMessage(
      [
        '你是 Manager Agent 的 Prompt 进化器。根据失败聚类与修复建议，生成可追加到 router/planner 的短规则（每条≤120字）。',
        '只输出严格 JSON：{ "router": string[], "planner": string[], "rationale": string, "confidence": 0..1 }',
        'router 补丁：路由/澄清/intent 判定；planner 补丁：多步拆解/query 写法。',
        '不要重复已有常识；不要要求泄露密钥；最多各 4 条。'
      ].join('\n')
    ),
    new HumanMessage(`失败洞察样本数=${insights.samples}\n修复建议：\n${summary}`)
  ]

  try {
    const r = await llmInvoke('critic', { resources: {}, meta: {} }, prompt)
    const parsed = JSON.parse(String(r.text || '').trim().replace(/^```json\s*/i, '').replace(/```\s*$/i, ''))
    const router = Array.isArray(parsed?.router) ? parsed.router.map((x: unknown) => String(x).trim()).filter(Boolean).slice(0, 4) : []
    const planner = Array.isArray(parsed?.planner) ? parsed.planner.map((x: unknown) => String(x).trim()).filter(Boolean).slice(0, 4) : []
    if (!router.length && !planner.length) return null
    const confidence = Math.max(0, Math.min(1, Number(parsed?.confidence ?? 0.72)))
    const routerAppend = isEvolutionRoutingHintEnabled() ? router : []
    return {
      version: 1,
      updatedAt: new Date().toISOString(),
      active: true,
      source: 'auto',
      confidence,
      rationale: String(parsed?.rationale || 'llm_evolution').slice(0, 300),
      router: { append: routerAppend },
      planner: { append: planner }
    }
  } catch {
    return null
  }
}

/**
 * finalize 后：从失败洞察生成 shadow Prompt 补丁；可选自动晋级到 active。
 */
export async function maybeEvolvePromptPatches(
  policyDir: string,
  insights: FailureInsightBundle,
  opts?: {
    llmInvoke?: (stage: 'critic', state: any, messages: any[]) => Promise<{ text: string }>
    force?: boolean
  }
): Promise<{ evolved: boolean; shadow?: boolean; promoted?: boolean; reason?: string }> {
  if (!isPromptEvolutionEnabled()) return { evolved: false, reason: 'disabled' }
  if ((insights.samples || 0) < 5 || !(insights.fixSuggestions?.length)) {
    return { evolved: false, reason: 'insufficient_signal' }
  }

  const last = await readLastEvolveTs(policyDir)
  if (!opts?.force && Date.now() - last < evolveMinIntervalMs()) {
    return { evolved: false, reason: 'throttled' }
  }

  let candidate =
    (opts?.llmInvoke ? await llmPatches(insights, opts.llmInvoke).catch(() => null) : null) || ruleBasedPatches(insights)
  if (!candidate) return { evolved: false, reason: 'no_candidate' }

  const active = await loadActivePromptPatches(policyDir)
  const shadow = await loadShadowPromptPatches(policyDir)
  const nextVersion = Math.max(Number(active?.version ?? 0), Number(shadow?.version ?? 0), 0) + 1
  candidate = { ...candidate, version: nextVersion }

  await writeShadowPromptPatches(policyDir, candidate)
  await writeLastEvolveTs(policyDir)

  let promoted = false
  if (autoPromoteEnabled() && Number(candidate.confidence ?? 0) >= 0.75) {
    const pr = await promoteShadowPromptPatches(policyDir, { minConfidence: 0.72 })
    promoted = pr.promoted
  }

  return { evolved: true, shadow: true, promoted, reason: promoted ? 'auto_promoted' : 'shadow_written' }
}
