import fs from 'node:fs/promises'
import path from 'node:path'
import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import type { FailureInsightBundle } from './failureInsights'
import {
  generateHypothesesFromInsights,
  loadHypotheses,
  persistHypotheses,
  type EvolutionHypothesis
} from './evolutionExperiments'

const STATE_FILE = 'manager-evolution-llm-hypothesis-state.json'

export function isEvolutionLlmHypothesisEnabled() {
  return String(process.env.MANAGER_EVOLUTION_LLM_HYPOTHESIS ?? '1').trim() !== '0'
}

function minIntervalMs() {
  const n = Number(process.env.MANAGER_EVOLUTION_LLM_HYPOTHESIS_INTERVAL_MS ?? 1_800_000)
  return Number.isFinite(n) && n >= 300_000 ? Math.min(86_400_000, Math.floor(n)) : 1_800_000
}

async function readLastRun(policyDir: string): Promise<number> {
  try {
    const raw = await fs.readFile(path.join(policyDir, STATE_FILE), 'utf8')
    const t = Date.parse(String(JSON.parse(raw)?.lastRunAt || ''))
    return Number.isFinite(t) ? t : 0
  } catch {
    return 0
  }
}

async function touchLastRun(policyDir: string) {
  await fs.writeFile(
    path.join(policyDir, STATE_FILE),
    JSON.stringify({ lastRunAt: new Date().toISOString() }, null, 2),
    'utf8'
  )
}

function safeJsonArray(text: string): unknown[] {
  const s = String(text || '').trim()
  const m = s.match(/\[[\s\S]*\]/)
  if (!m) return []
  try {
    const arr = JSON.parse(m[0])
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function normalizeLlmHypothesis(raw: unknown, insights: FailureInsightBundle): EvolutionHypothesis | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const statement = String(o.statement || o.hypothesis || '').trim()
  if (!statement || statement.length < 8) return null
  const artifactRaw = String(o.artifact || 'prompt_patches').trim()
  const artifact = (['policy', 'prompt_patches', 'planner_rules'].includes(artifactRaw)
    ? artifactRaw
    : 'prompt_patches') as EvolutionHypothesis['artifact']
  const category = String(o.category || insights.failures[0]?.category || 'llm_hypothesis').trim()
  const conf = Number(o.confidence ?? 0.55)
  const id = `hyp_llm_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`
  return {
    id,
    createdAt: new Date().toISOString(),
    category,
    statement: statement.slice(0, 320),
    artifact,
    expectedEffect: String(o.expectedEffect || o.effect || '提升路由/规划成功率').slice(0, 200),
    confidence: Math.max(0.35, Math.min(0.92, Number.isFinite(conf) ? conf : 0.55)),
    sourceSignals: ['llm_hypothesis', ...(Array.isArray(o.sourceSignals) ? o.sourceSignals.map(String).slice(0, 3) : [])]
  }
}

/** LLM 提出可验证进化假设（与规则假设合并入队） */
export async function maybeGenerateLlmEvolutionHypotheses(
  policyDir: string,
  insights: FailureInsightBundle
): Promise<{ added: number; skipped?: string }> {
  if (!isEvolutionLlmHypothesisEnabled()) return { added: 0, skipped: 'disabled' }
  if (!insights.samples || insights.samples < 5) return { added: 0, skipped: 'insufficient_samples' }

  const last = await readLastRun(policyDir)
  if (Date.now() - last < minIntervalMs()) return { added: 0, skipped: 'interval' }

  const apiKey = String(process.env.OPENAI_API_KEY || '').trim()
  const baseUrl = String(process.env.OPENAI_BASE_URL || '').trim()
  const model = String(process.env.MANAGER_MODEL_EVOLVE || process.env.OPENAI_MODEL || '').trim()
  if (!apiKey || !baseUrl || !model) return { added: 0, skipped: 'missing_llm_env' }

  const failureSummary = (insights.failures || [])
    .slice(0, 5)
    .map((f) => `${f.category}: ${f.count}次, 原因样例=${(f.topReasons || []).slice(0, 2).join(';')}`)
    .join('\n')
  const ruleHypos = generateHypothesesFromInsights(insights)
    .slice(0, 4)
    .map((h) => `- [${h.artifact}] ${h.statement}`)
    .join('\n')

  const llm = new ChatOpenAI({
    apiKey,
    modelName: model,
    temperature: 0.2,
    configuration: { baseURL: baseUrl }
  })

  try {
    const resp = await llm.invoke([
      new SystemMessage(
        [
          '你是 Manager Agent 进化实验设计器。根据失败洞察提出**可验证**的改进假设。',
          '只输出 JSON 数组，每项字段：category, statement, artifact(policy|prompt_patches|planner_rules), expectedEffect, confidence(0-1)。',
          '不要重复已有规则假设；最多 3 条；面向可 A/B 金丝雀验证的改动。'
        ].join('\n')
      ),
      new HumanMessage(
        [
          `失败样本数：${insights.samples}`,
          `失败聚类：\n${failureSummary || '（无）'}`,
          `已有规则假设：\n${ruleHypos || '（无）'}`,
          '输出 JSON 数组：'
        ].join('\n\n')
      )
    ])
    const parsed = safeJsonArray(String((resp as { content?: string })?.content ?? ''))
    const hypos: EvolutionHypothesis[] = []
    const existing = new Set((await loadHypotheses(policyDir)).map((h) => h.statement.slice(0, 80)))
    for (const row of parsed.slice(0, 4)) {
      const h = normalizeLlmHypothesis(row, insights)
      if (!h) continue
      const key = h.statement.slice(0, 80)
      if (existing.has(key)) continue
      existing.add(key)
      hypos.push(h)
    }
    const added = await persistHypotheses(policyDir, hypos)
    await touchLastRun(policyDir)
    return { added }
  } catch {
    await touchLastRun(policyDir)
    return { added: 0, skipped: 'llm_error' }
  }
}
