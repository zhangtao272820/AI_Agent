/**
 * 子 Agent / 任务成功判定（Tool Memory、Skill draft、DB 经验同步共用）
 * 原则：子 Agent 有实质结果 + successScore 达标 → 记成功，不因综合层 route_error 误杀。
 */

import { AMP_EXPERIENCE_SUCCESS_THRESHOLD } from './agentMemoryPolicy'
import { isFederationFeedbackGated } from './artifactFeedbackPolicy'

/** 综合层失败但子 Agent 已产出时可视为「工具成功」 */
const NON_FATAL_FOR_TOOL = new Set([
  'route_error',
  'synthesis_error',
  'verification_gap',
  'unclear'
])

export type AgentOutcomeInput = {
  agentName: string
  resultText: string
  successScore: number
  needsClarify?: boolean
  failureCategory?: string
  probeDbMatched?: boolean
  probeRagHits?: number
}

export type RunOutcomeInput = {
  successScore: number
  needsClarify?: boolean
  failureCategory?: string
  planAgents: string[]
  results: Record<string, unknown>
  probeDbMatched?: boolean
  probeRagHits?: number
}

function normAgent(name: string): string {
  return String(name || '').trim().toLowerCase()
}

function hasSubstantialResult(text: string, minLen = 8): boolean {
  const t = String(text || '').replace(/\s+/g, ' ').trim()
  return t.length >= minLen
}

/** 单个子 Agent 是否算工具调用成功 */
export function isAgentToolSuccess(input: AgentOutcomeInput, env: NodeJS.ProcessEnv = process.env): boolean {
  if (input.needsClarify) return false
  if (input.successScore < AMP_EXPERIENCE_SUCCESS_THRESHOLD) return false

  const agent = normAgent(input.agentName)
  const strictProbe = String(env.MGR_STRICT_TOOL_SUCCESS ?? '1').trim() !== '0'
  const probeOnlyOk =
    !strictProbe &&
    ((agent === 'db' && input.probeDbMatched) || (agent === 'rag' && (Number(input.probeRagHits ?? 0) > 0)))

  if (probeOnlyOk) return true
  if (!hasSubstantialResult(input.resultText)) return false

  if (agent === 'db') {
    return hasSubstantialResult(input.resultText, 16)
  }
  if (agent === 'rag') {
    return hasSubstantialResult(input.resultText, 16)
  }
  if (agent === 'code' || agent === 'crawler' || agent === 'gui') {
    return hasSubstantialResult(input.resultText, 12)
  }
  if (input.failureCategory === 'success') return true
  if (input.failureCategory && NON_FATAL_FOR_TOOL.has(input.failureCategory)) return true
  return input.successScore >= 0.8
}

/** 整轮任务是否值得 Skill 自动 draft */
export function isSkillDraftEligible(
  input: RunOutcomeInput,
  minScore = Number(process.env.MGR_SKILL_AUTO_DRAFT_MIN_SCORE ?? 0.85)
): boolean {
  if (input.needsClarify) return false
  const threshold = Number.isFinite(minScore) && minScore >= AMP_EXPERIENCE_SUCCESS_THRESHOLD ? minScore : 0.85
  if (input.successScore < threshold) return false

  const anyAgentOk = input.planAgents.some((agentName) =>
    isAgentToolSuccess({
      agentName,
      resultText: String(input.results[agentName] ?? ''),
      successScore: input.successScore,
      needsClarify: input.needsClarify,
      failureCategory: input.failureCategory,
      probeDbMatched: input.probeDbMatched,
      probeRagHits: input.probeRagHits
    })
  )
  if (anyAgentOk) return true
  return input.failureCategory === 'success'
}

/** DB 路径是否应写入 db_query_experience（P0：门控开启时 defer 至 👍 confirm） */
export function shouldSyncDbExperience(
  input: RunOutcomeInput,
  env: NodeJS.ProcessEnv = process.env,
  opts?: { force?: boolean }
): boolean {
  if (!opts?.force && isFederationFeedbackGated(env)) return false
  if (!input.planAgents.map(normAgent).includes('db')) return false
  const dbText = String(input.results.db ?? input.results.DB ?? '')
  return isAgentToolSuccess({
    agentName: 'db',
    resultText: dbText,
    successScore: input.successScore,
    needsClarify: input.needsClarify,
    failureCategory: input.failureCategory,
    probeDbMatched: input.probeDbMatched
  })
}

/** RAG 路径是否应写入 rag_learning_signals（P0：门控开启时 defer 至 👍 confirm） */
export function shouldSyncRagExperience(
  input: RunOutcomeInput,
  env: NodeJS.ProcessEnv = process.env,
  opts?: { force?: boolean }
): boolean {
  if (!opts?.force && isFederationFeedbackGated(env)) return false
  if (!input.planAgents.map(normAgent).includes('rag')) return false
  const ragText = String(input.results.rag ?? input.results.RAG ?? '')
  return isAgentToolSuccess({
    agentName: 'rag',
    resultText: ragText,
    successScore: input.successScore,
    needsClarify: input.needsClarify,
    failureCategory: input.failureCategory,
    probeRagHits: input.probeRagHits
  })
}

/** Admin 路径是否应写入 adm_tool_experience（P0：门控开启时 defer 至 👍 confirm） */
export function shouldSyncAdminExperience(
  input: RunOutcomeInput,
  env: NodeJS.ProcessEnv = process.env,
  opts?: { force?: boolean }
): boolean {
  if (!opts?.force && isFederationFeedbackGated(env)) return false
  if (!input.planAgents.map(normAgent).includes('admin')) return false
  const adminText = String(input.results.admin ?? input.results.Admin ?? '')
  return isAgentToolSuccess({
    agentName: 'admin',
    resultText: adminText,
    successScore: input.successScore,
    needsClarify: input.needsClarify,
    failureCategory: input.failureCategory
  })
}

/** Code 路径是否应写入 code_query_experience */
export function shouldSyncCodeExperience(
  input: RunOutcomeInput,
  env: NodeJS.ProcessEnv = process.env,
  opts?: { force?: boolean }
): boolean {
  if (!opts?.force && isFederationFeedbackGated(env)) return false
  if (!input.planAgents.map(normAgent).includes('code')) return false
  const codeText = String(input.results.code ?? input.results.Code ?? '')
  return isAgentToolSuccess({
    agentName: 'code',
    resultText: codeText,
    successScore: input.successScore,
    needsClarify: input.needsClarify,
    failureCategory: input.failureCategory
  })
}

/** Crawler/Extractor 路径是否应写入 ext_crawl_experience */
export function shouldSyncCrawlerExperience(
  input: RunOutcomeInput,
  env: NodeJS.ProcessEnv = process.env,
  opts?: { force?: boolean }
): boolean {
  if (!opts?.force && isFederationFeedbackGated(env)) return false
  if (!input.planAgents.map(normAgent).includes('crawler')) return false
  const crawlerText = String(input.results.crawler ?? input.results.Crawler ?? '')
  return isAgentToolSuccess({
    agentName: 'crawler',
    resultText: crawlerText,
    successScore: input.successScore,
    needsClarify: input.needsClarify,
    failureCategory: input.failureCategory
  })
}

/** GUI/Lobster 路径是否应写入 lob_gui_experience */
export function shouldSyncGuiExperience(
  input: RunOutcomeInput,
  env: NodeJS.ProcessEnv = process.env,
  opts?: { force?: boolean }
): boolean {
  if (!opts?.force && isFederationFeedbackGated(env)) return false
  if (!input.planAgents.map(normAgent).includes('gui')) return false
  const guiText = String(input.results.gui ?? input.results.Gui ?? '')
  return isAgentToolSuccess({
    agentName: 'gui',
    resultText: guiText,
    successScore: input.successScore,
    needsClarify: input.needsClarify,
    failureCategory: input.failureCategory
  })
}
