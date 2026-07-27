import { executeMcpToolStep } from '../../core/executors/mcpToolExecutor'
import { resolveMcpDirectCallFromMeta, isManagerMcpToolNodeEnabled } from '../../../utils/mcp/resolveMcpDirectCall'
import { resolveExecutionQuery } from '../../core/routing/clauses'
import { emitSingleStepPlanEvent } from '../../core/plan/planStepsEvent'
import { createExecContext } from './context'
import { compactStepInput } from './helpers'
import type { CreateExecutionNodesDeps } from './types'

export function buildMcpToolNode(deps: CreateExecutionNodesDeps) {
  const { ensureNotAborted, opts, lastUserText, appendMetrics, emitTrace, summarize, notifyAgentFailure } =
    createExecContext(deps)

  return async (state: any) => {
    ensureNotAborted()
    if (!isManagerMcpToolNodeEnabled()) {
      opts.sendEvent({ event: 'thinking', data: 'MCP 工具节点已关闭（MANAGER_MCP_TOOL_NODE=0）', from: 'manager' })
      return { results: { mcp: '' }, evidence: [{ kind: 'mcp', error: 'disabled' }] }
    }

    const request = resolveMcpDirectCallFromMeta(state.meta)
    if (!request) {
      return {
        results: { mcp: '' },
        evidence: [{ kind: 'mcp', error: 'missing mcpDirectCall or envelope.mcp' }],
      }
    }

    opts.sendEvent({ event: 'phase', data: 'execute:mcp_tool', from: 'manager' })
    const question = resolveExecutionQuery('gui', state, lastUserText(state.messages))
    emitSingleStepPlanEvent(opts, 'mcp', `${request.serverName}/${request.toolName}`)
    const t0 = Date.now()
    emitTrace({
      type: 'step_start',
      agent: 'mcp',
      input: compactStepInput(`${request.serverName}::${request.toolName}`),
      at: new Date().toISOString(),
    })

    const outcome = await executeMcpToolStep({
      request,
      query: question,
      sendThinking: (t) => opts.sendEvent({ event: 'thinking', data: t, from: 'mcp' }),
    })

    await appendMetrics({ runId: opts.runId, phase: 'mcp_tool', ms: Date.now() - t0 })
    emitTrace({
      type: 'step_end',
      agent: 'mcp',
      ms: Date.now() - t0,
      status: outcome.ok ? 'ok' : 'error',
      outputSummary: summarize(outcome.output),
      error: outcome.ok ? undefined : outcome.error,
      at: new Date().toISOString(),
    })
    if (!outcome.ok) notifyAgentFailure('mcp', String(outcome.error || 'mcp tool failed'))

    const evidence = outcome.evidence ?? { kind: 'mcp', server: request.serverName, tool: request.toolName }
    return { results: { mcp: outcome.output }, evidence: [evidence] }
  }
}
