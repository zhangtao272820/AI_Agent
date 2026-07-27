/**
 * 入站问句清洗：兼容总管 execNodes 包装，还原核心任务与上游上下文。
 */

import { getCodeAgentEnv } from './code_agent_env'

const PLANNER_BLOCK_RE = /\n{1,2}\[(约束|上下文|上游|步骤|总管)[^\]]*\][\s\S]*$/i
const UPSTREAM_CTX_RE = /\n{1,2}已知上下文[：:]\s*([\s\S]*?)(?:\n{1,2}请基于以上上下文|$)/
const MANAGER_COMPUTE_TAIL_RE = /\n{1,2}请基于以上上下文做[\s\S]*$/i
const MANAGER_COMPUTE_INLINE_RE = /请基于以上上下文做(计算|整理|推导)/

export function extractManagerUpstreamContext(raw: string): string | null {
  const m = String(raw ?? '').match(UPSTREAM_CTX_RE)
  const ctx = m?.[1]?.trim()
  return ctx || null
}

/** 总管 execNodes 下发的 compute 任务特征 */
export function looksLikeManagerComputeTask(raw: string): boolean {
  const t = String(raw ?? '')
  if (MANAGER_COMPUTE_INLINE_RE.test(t)) return true
  if (/已知上下文[：:]/.test(t) && MANAGER_COMPUTE_TAIL_RE.test(t)) return true
  return false
}

export function sanitizeIncomingQuestion(raw: string): string {
  const max = getCodeAgentEnv().incomingQuestionMaxChars
  let q = String(raw ?? '').replace(/\r\n/g, '\n').trim()
  if (!q) return ''

  q = q.replace(PLANNER_BLOCK_RE, '').trim()
  q = q.replace(MANAGER_COMPUTE_TAIL_RE, '').trim()
  q = q.replace(/\n{1,2}已知上下文[：:]\s*[\s\S]*$/i, '').trim()
  q = q.replace(/请基于以上上下文做[\s\S]*$/i, '').trim()

  const lines = q
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => {
      if (!l) return false
      if (/^(rag|db|clean|crawler|admin):/i.test(l)) return false
      return true
    })
  q = lines.join('\n').trim() || String(raw ?? '').trim()

  return q.replace(/\s+/g, ' ').trim().slice(0, max) || String(raw ?? '').trim().slice(0, max)
}
