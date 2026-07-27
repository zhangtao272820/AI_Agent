import type { ManagerCrawlerLlmHints } from '../../../utils/crawler/managerCrawlerTaskLlm'
import type { LlmInvokeFn } from '../../llm/taskConstraintsLlm'
import type { ManagerGraphState } from '../../state/state'
import type { Step } from '../../../utils/shared/taskPlan'
import type { AgentExecutorDeps, AgentExecutorOpts, AgentStepOutcome, VoteScore } from './types'
import { executeDbStep } from './dbExecutor'
import { executeRagStep } from './ragExecutor'
import { executeCrawlerStep } from './crawlerExecutor'
import { executeGuiStep } from './guiExecutor'
import { executeAdminStep } from './adminExecutor'
import { executeCodeStep } from './codeExecutor'
import { executeMultimodalStep, executeMusicStep, executeVideoStep } from './mediaExecutors'
import { executeInternalStep } from './internalExecutor'
import { executeMcpToolStep } from './mcpToolExecutor'
import { isManagerMcpToolNodeEnabled } from '../../../utils/mcp/resolveMcpDirectCall'

export async function dispatchPlanAgentStep(
  agent: Step['agent'],
  ctx: {
    deps: AgentExecutorDeps
    opts: AgentExecutorOpts
    state: ManagerGraphState
    question: string
    baseQuery: string
    effQuery: string
    scopeQuery?: string
    out: Record<string, string>
    timeoutMs: number
    sendThinking: (agent: string, text: string) => void
    allowRetry: boolean
    llm?: { openaiApiKey?: string; openaiModel?: string; openaiBaseUrl?: string } | null
    llmInvoke?: LlmInvokeFn | null
    crawlerLlmHints?: ManagerCrawlerLlmHints | null
    mcpTool?: Step['mcpTool']
    internal?: {
      internalQuery: string
      payload: unknown
      vote?: {
        enabled: boolean
        score: (text: string) => VoteScore
        onDecision?: (d: {
          selected: 'A' | 'B'
          scoreA: VoteScore
          scoreB: VoteScore
          winnerReason: string
        }) => void
      }
      rewriteVisualize?: (text: string) => string
    }
  }
): Promise<AgentStepOutcome | null> {
  const relay = (t: string) => ctx.sendThinking(agent, t)
  if (ctx.mcpTool && isManagerMcpToolNodeEnabled()) {
    return executeMcpToolStep({
      request: {
        serverName: String(ctx.mcpTool.server).trim(),
        toolName: String(ctx.mcpTool.tool).trim(),
        args: ctx.mcpTool.arguments,
      },
      query: ctx.effQuery,
      sendThinking: relay,
    })
  }
  switch (agent) {
    case 'db':
      return executeDbStep(ctx.deps, ctx.opts, {
        state: ctx.state,
        effQuery: ctx.effQuery,
        timeoutMs: ctx.timeoutMs,
        sendThinking: relay,
        llmInvoke: ctx.llmInvoke,
        llm: ctx.llm
      })
    case 'rag':
      return executeRagStep(ctx.deps, ctx.opts, {
        state: ctx.state,
        question: ctx.question,
        baseQuery: ctx.baseQuery,
        effQuery: ctx.effQuery,
        timeoutMs: ctx.timeoutMs,
        sendThinking: relay,
        allowRetry: ctx.allowRetry,
        onStrategyHint: (meta) => {
          const m = meta as { mode?: string; probeHits?: number; sourceCount?: number }
          if (m?.mode === 'heuristic_v1') {
            ctx.opts.sendEvent({
              event: 'thinking',
              data: `RAG 检索策略：${m.mode}（probeHits=${Number(m.probeHits ?? 0)}，sources=${Number(m.sourceCount ?? 0)}）`,
              from: 'manager'
            })
          }
        }
      })
    case 'crawler':
      return executeCrawlerStep(ctx.deps, ctx.opts, {
        state: ctx.state,
        effQuery: ctx.effQuery,
        timeoutMs: ctx.timeoutMs,
        sendThinking: relay,
        allowRetry: ctx.allowRetry,
        llmHints: ctx.crawlerLlmHints,
        llm: ctx.llm,
        llmInvoke: ctx.llmInvoke
      })
    case 'gui':
      return executeGuiStep(ctx.deps, ctx.opts, {
        state: ctx.state,
        effQuery: ctx.effQuery,
        timeoutMs: ctx.timeoutMs,
        sendThinking: relay
      })
    case 'admin':
      return executeAdminStep(ctx.deps, ctx.opts, {
        state: ctx.state,
        effQuery: ctx.effQuery,
        scopeQuery: ctx.scopeQuery,
        timeoutMs: ctx.timeoutMs,
        sendThinking: (t) => ctx.sendThinking('admin', t),
        llmInvoke: ctx.llmInvoke
      })
    case 'code':
      return executeCodeStep(ctx.deps, ctx.opts, {
        state: ctx.state,
        effQuery: ctx.effQuery,
        out: ctx.out,
        timeoutMs: ctx.timeoutMs,
        sendThinking: relay,
        sendDelta: (d) => ctx.opts.sendEvent({ event: 'delta', data: d, from: 'code' }),
        llm: ctx.llm
      })
    case 'multimodal':
      return executeMultimodalStep(ctx.deps, ctx.opts, {
        state: ctx.state,
        effQuery: ctx.effQuery,
        timeoutMs: ctx.timeoutMs
      })
    case 'music':
      return executeMusicStep(ctx.deps, ctx.opts, {
        effQuery: ctx.effQuery,
        timeoutMs: ctx.timeoutMs,
        sendThinking: relay,
        meta: (ctx.state.meta as Record<string, unknown> | undefined) ?? null
      })
    case 'video':
      return executeVideoStep(ctx.deps, ctx.opts, {
        effQuery: ctx.effQuery,
        timeoutMs: ctx.timeoutMs,
        sendThinking: relay,
        meta: (ctx.state.meta as Record<string, unknown> | undefined) ?? null
      })
    case 'clean':
    case 'visualize':
    case 'report':
      return ctx.internal
        ? executeInternalStep(ctx.deps, {
            agent,
            internalQuery: ctx.internal.internalQuery,
            payload: ctx.internal.payload,
            state: ctx.state,
            out: ctx.out,
            vote: ctx.internal.vote,
            rewriteVisualize: ctx.internal.rewriteVisualize,
            llm: ctx.llm,
            runId: ctx.opts.runId
          })
        : null
    default:
      return null
  }
}
