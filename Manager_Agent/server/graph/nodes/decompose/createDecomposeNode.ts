import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { z } from 'zod'
import { isClauseDecomposeEnabled, type TaskClause } from '../../core/routing/clauses'
import { appendClauseDecomposeMetric } from '../../core/routing/clauseMetrics'
import { routingHeuristicsUserText } from '../../core/text'
import { getRouterDecomposePlaybook } from '../../core/evolution/playbookPrompts'
import { isChitchatTurn, resolveTurnRoutingScope } from '../../core/routing/turnScope'
import { sessionIntentAnchorFromMeta } from '../../core/memory/multiTurnIntent'
import { shouldSkipLegacyRoutingNodes } from '../../orchestrate/unifiedRouting'

const DECOMPOSE_PLAYBOOK_FALLBACK =
  '你是用户问题拆解器。拆成 1～6 条子句并标注 agent。只输出 JSON：{"clauses":[{"text":"...","agents":["rag"]}]}'

const ClauseItemSchema = z.object({
  text: z.string().min(4),
  layer: z.enum(['data', 'process', 'output', 'action']).optional(),
  agents: z
    .array(
      z.enum([
        'db',
        'rag',
        'code',
        'crawler',
        'gui',
        'admin',
        'visualize',
        'report',
        'clean',
        'multimodal',
        'music',
        'video'
      ])
    )
    .optional()
})

const DecomposeSchema = z.object({
  clauses: z.array(ClauseItemSchema).min(1).max(8)
})

import type { CreateDecomposeNodeDeps } from './types'

export function createDecomposeNode(deps: CreateDecomposeNodeDeps) {
  const { opts, sessionId, runId, lastUserText, llmInvoke, safeJsonParse, mergeMeta } = deps

  return async (state: any) => {
    const t0 = Date.now()
    if (shouldSkipLegacyRoutingNodes(state) && (state?.meta?.unifiedOrchestrator || state?.meta?.taskClauses?.length)) {
      return {}
    }

    if (!isClauseDecomposeEnabled(sessionId)) {
      appendClauseDecomposeMetric({
        ts: new Date().toISOString(),
        sessionId,
        runId,
        mode: 'off',
        clauseCount: 0,
        agents: [],
        ms: Date.now() - t0,
        rollout: false
      })
      return { meta: mergeMeta(state, { clauseDecomposeMode: 'off' as const, clauseCount: 0 }) }
    }

    opts.sendEvent({ event: 'phase', data: 'decompose', from: 'manager' })
    const lastOnly = String(lastUserText(state.messages) || '').trim()
    const turnScope = resolveTurnRoutingScope({
      messages: state.messages as any,
      lastUser: lastOnly,
      sessionAnchor: sessionIntentAnchorFromMeta(state.meta),
      attachment: state.mediaAttachment,
      meta: state.meta
    })
    const turnIsolated = turnScope.mode !== 'continuation'

    if (isChitchatTurn(turnScope)) {
      return {
        meta: mergeMeta(state, {
          taskClauses: [{ id: 'c1', text: lastOnly, agents: [] }],
          clauseDecomposeMode: 'skip',
          clauseCount: 1,
          turnScope: 'chitchat'
        })
      }
    }

    const heuristicsText = turnScope.suppressMultiTurnMerge
      ? lastOnly
      : String(state.meta?.nlHeuristicTask || '').trim() ||
        String(routingHeuristicsUserText(state.messages as any) || '').trim() ||
        lastOnly

    let clauses: TaskClause[] = [{ id: 'c1', text: heuristicsText, agents: [] }]
    let decomposeMode: 'llm' | 'skip' = 'skip'

    if (llmInvoke && heuristicsText.length >= 8) {
      try {
        const decomposePlaybook = getRouterDecomposePlaybook(DECOMPOSE_PLAYBOOK_FALLBACK)
        const prompt = [
          new SystemMessage(decomposePlaybook),
          new HumanMessage(`用户输入：\n${heuristicsText}\n\n补充约束：请优先保持 admin 子任务独立，不要与 code 合并；若任务是总Agent统筹类，也要保留总Agent语义，不要硬拆成具体执行步骤。\n\n只输出 JSON：`)
        ]
        const r = await llmInvoke('route', state, prompt, { tier: 'light' })
        const parsed = DecomposeSchema.safeParse(safeJsonParse(String(r.text || '')))
        if (parsed.success) {
          clauses = parsed.data.clauses.map((c, i) => ({
            id: `c${i + 1}`,
            text: c.text.trim(),
            agents: (c.agents || []) as TaskClause['agents'],
            ...(c.layer ? { layer: c.layer } : {})
          }))
          decomposeMode = 'llm'
        }
      } catch {
        clauses = [{ id: 'c1', text: heuristicsText, agents: [] }]
      }
    }

    if (!state?.meta?.lowCostMode && decomposeMode === 'llm' && clauses.length > 1) {
      opts.sendEvent({
        event: 'thinking',
        data: `子任务拆解（LLM）：${clauses.length} 条`,
        from: 'manager'
      })
    }

    const agents = [...new Set(clauses.flatMap((c) => c.agents || []))]
    appendClauseDecomposeMetric({
      ts: new Date().toISOString(),
      sessionId,
      runId,
      mode: decomposeMode,
      clauseCount: clauses.length,
      agents,
      ms: Date.now() - t0,
      rollout: true
    })

    return {
      meta: mergeMeta(state, {
        taskClauses: clauses,
        clauseDecomposeMode: decomposeMode,
        clauseCount: clauses.length,
        ...(turnIsolated ? { turnScope: turnScope.mode } : {})
      })
    }
  }
}

