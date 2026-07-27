import path from 'node:path'
import fs from 'node:fs/promises'
import type { FailureInsightBundle } from './failureInsights'
import {
  loadActivePlannerRules,
  loadShadowPlannerRules,
  promoteShadowPlannerRules,
  type PlannerRule,
  type PlannerRuleSet,
  writeShadowPlannerRules
} from './plannerRules'

const LAST_EVOLVE_FILE = 'manager-planner-rules-evolve-state.json'

export function isPlannerRuleEvolutionEnabled() {
  return String(process.env.MANAGER_PLANNER_RULE_EVOLVE ?? '1').trim() !== '0'
}

function evolveMinIntervalMs() {
  const n = Number(process.env.MANAGER_PLANNER_RULE_EVOLVE_MIN_INTERVAL_MS ?? 900_000)
  return Number.isFinite(n) && n >= 60_000 ? Math.min(86_400_000, Math.floor(n)) : 900_000
}

function autoPromoteEnabled() {
  return String(process.env.MANAGER_PLANNER_RULE_AUTO_PROMOTE ?? '0').trim() === '1'
}

async function readLastEvolveTs(policyDir: string): Promise<number> {
  try {
    const raw = await fs.readFile(path.join(policyDir, LAST_EVOLVE_FILE), 'utf8')
    const t = Date.parse(String(JSON.parse(raw)?.updatedAt || ''))
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

function rulesFromInsights(insights: FailureInsightBundle): PlannerRule[] {
  const rules: PlannerRule[] = []
  const seen = new Set<string>()

  const push = (rule: PlannerRule) => {
    if (seen.has(rule.id)) return
    seen.add(rule.id)
    rules.push(rule)
  }

  for (const b of insights.fixSuggestions || []) {
    for (const s of b.suggestions || []) {
      if (s.scope !== 'planner' && s.scope !== 'execution') continue
      const cat = b.category
      if (cat === 'evidence_gap') {
        push({
          id: 'auto_report_after_db',
          whenIntent: 'multi',
          whenAllowedIncludes: ['report', 'db'],
          requireAfter: [{ agent: 'report', after: 'db' }],
          message: '报告须依赖 db 查询步骤（证据先行）'
        })
        push({
          id: 'auto_report_after_rag',
          whenIntent: 'multi',
          whenAllowedIncludes: ['report', 'rag'],
          requireAfter: [{ agent: 'report', after: 'rag' }],
          message: '报告须依赖 rag 检索步骤（证据先行）'
        })
      }
      if (cat === 'plan_error' && (b.suggestions?.length || 0) >= 1) {
        push({
          id: 'auto_plan_min_data_when_multi',
          whenIntent: 'multi',
          whenAllowedIncludes: ['db', 'report'],
          requireAgents: ['db'],
          message: 'multi 且含 report 时须保留 db 取数步骤'
        })
      }
      if (cat === 'tool_failure') {
        for (const hint of s.hints || []) {
          const ag = ['db', 'rag', 'code', 'crawler', 'admin', 'multimodal', 'music', 'video'].find((a) =>
            hint.toLowerCase().includes(a)
          )
          if (ag) {
            push({
              id: `auto_forbid_${ag}_degraded`,
              whenIntent: 'multi',
              forbidAgents: [ag],
              message: `工具 ${ag} 近期失败率高，规划时暂勿使用`
            })
          }
        }
      }
    }
  }

  const top = insights.failures[0]
  if (top?.category === 'route_error') {
    push({
      id: 'auto_multi_respect_allowed',
      whenIntent: 'multi',
      message: '步骤 agent 不得超出 route 给出的 allowedAgents'
    })
  }

  return rules.slice(0, 16)
}

export async function maybeEvolvePlannerRules(
  policyDir: string,
  insights: FailureInsightBundle,
  opts?: { force?: boolean }
): Promise<{ evolved: boolean; promoted?: boolean; reason?: string }> {
  if (!isPlannerRuleEvolutionEnabled()) return { evolved: false, reason: 'disabled' }
  if (!insights.fixSuggestions?.length && !opts?.force) return { evolved: false, reason: 'no_suggestions' }

  const last = await readLastEvolveTs(policyDir)
  if (!opts?.force && Date.now() - last < evolveMinIntervalMs()) {
    return { evolved: false, reason: 'cooldown' }
  }

  const generated = rulesFromInsights(insights)
  if (!generated.length) return { evolved: false, reason: 'no_rules' }

  const active = await loadActivePlannerRules(policyDir)
  const mergedRules: PlannerRule[] = []
  const byId = new Map<string, PlannerRule>()
  for (const r of active?.rules || []) byId.set(r.id, r)
  for (const r of generated) byId.set(r.id, r)
  for (const r of byId.values()) mergedRules.push(r)

  const confidence = Math.min(
    0.9,
    0.55 + Math.min(0.2, (insights.samples || 0) / 60) + (insights.failures[0]?.count >= 3 ? 0.12 : 0)
  )

  const shadow: PlannerRuleSet = {
    version: (active?.version || 0) + 1,
    updatedAt: new Date().toISOString(),
    active: false,
    source: 'auto',
    confidence,
    rationale: insights.strongestSignals.join('；') || 'failure_cluster',
    rules: mergedRules.slice(0, 20)
  }

  await writeShadowPlannerRules(policyDir, shadow)
  await writeLastEvolveTs(policyDir)

  let promoted = false
  if (autoPromoteEnabled() && confidence >= 0.72) {
    const pr = await promoteShadowPlannerRules(policyDir, { minConfidence: 0.72 })
    promoted = pr.promoted
  }

  return { evolved: true, promoted, reason: 'shadow_written' }
}
