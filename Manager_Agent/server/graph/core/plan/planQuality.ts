import fs from 'node:fs/promises'
import path from 'node:path'
import { readHistoryEntries } from '../shared'
import { indexMemoryEntry, isVectorMemoryEnabled } from '../memory/vectorMemory'
import { deriveScenarioKey } from '../text'

export type PlanQualitySignal = {
  llmPlanSuccessRate: number
  ruleFallbackRate: number
  avgSteps: number
  samples: number
}

/** 从 plan_llm 记忆统计规划质量，供策略学习与 planner 提示 */
export async function analyzePlanQualityFromMemory(policyDir: string): Promise<PlanQualitySignal> {
  const jsonl = path.join(policyDir, 'manager-memory.jsonl')
  const json = path.join(policyDir, 'manager-memory.json')
  const history = await readHistoryEntries(jsonl, json, 280)
  const plans = (Array.isArray(history) ? history : []).filter((h) => h?.type === 'plan_llm').slice(-60)
  if (!plans.length) {
    return { llmPlanSuccessRate: 0.7, ruleFallbackRate: 0.3, avgSteps: 2, samples: 0 }
  }

  let ruleFallback = 0
  let stepSum = 0
  let validLlm = 0
  for (const p of plans) {
    const plan = Array.isArray(p?.plan) ? p.plan : []
    stepSum += plan.length
    const isRule = Boolean(p?.ruleFallback) || String(p?.source || '') === 'rule'
    if (isRule) ruleFallback += 1
    else if (plan.length >= 1) validLlm += 1
  }
  const n = plans.length
  return {
    llmPlanSuccessRate: n ? validLlm / n : 0.7,
    ruleFallbackRate: n ? ruleFallback / n : 0,
    avgSteps: n ? stepSum / n : 2,
    samples: n
  }
}

export function planQualityHintForPlanner(signal: PlanQualitySignal): string {
  if (signal.samples < 8) return ''
  if (signal.ruleFallbackRate > 0.45) {
    return '【系统提示】近期多步规划频繁走规则兜底，请务必为每个数据源步骤输出极简、可独立执行的 query，勿复述整段用户原话。'
  }
  if (signal.avgSteps > 5) {
    return '【系统提示】近期计划步骤偏多，请合并同源检索、避免重复 agent。'
  }
  return ''
}

export async function recordPlanOutcome(
  policyDir: string,
  entry: {
    user: string
    intent: string
    plan: any[]
    source: 'llm' | 'rule' | 'single'
    successScore?: number
    runId?: string
  }
) {
  const p = path.join(policyDir, 'manager-memory.jsonl')
  const line = JSON.stringify({
    type: 'plan_outcome',
    ts: new Date().toISOString(),
    ...entry,
    stepCount: Array.isArray(entry.plan) ? entry.plan.length : 0,
    ruleFallback: entry.source === 'rule'
  })
  await fs.mkdir(policyDir, { recursive: true }).catch(() => undefined)
  await fs.appendFile(p, `${line}\n`, 'utf8').catch(() => undefined)
  if (isVectorMemoryEnabled() && entry.user.length >= 6) {
    indexMemoryEntry(policyDir, {
      user: entry.user,
      memoryType: 'plan_outcome',
      intent: entry.intent,
      scenarioKey: deriveScenarioKey(entry.user),
      successScore: entry.successScore,
      ts: new Date().toISOString()
    }).catch(() => undefined)
  }
}
