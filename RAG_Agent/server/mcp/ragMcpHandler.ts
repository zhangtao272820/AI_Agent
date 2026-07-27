/**
 * RAG MCP export：retrieve + health
 */
import { runDocumentRetrieval } from '../utils/document_retrieval'
import { sanitizeIncomingQuestion } from '../utils/incoming_question'
import {
  mcpErr,
  mcpOk,
  mcpTextResult,
  parseMcpToolCallParams,
  type McpJsonRpcRequest,
} from '#agent-shared/mcpJsonRpc'
import { RAG_MCP_TOOLS, isRagMcpServerEnabled } from './ragMcpSchema'

export { isRagMcpServerEnabled, RAG_MCP_TOOLS }

const TOOLS = RAG_MCP_TOOLS

async function retrieveTool(args: Record<string, unknown>) {
  const raw = String(args.query ?? '').trim()
  if (!raw) throw new Error('query 必填')
  const query = sanitizeIncomingQuestion(raw) || raw
  const result = await runDocumentRetrieval({
    query,
    rawQuery: raw,
    fastPath: args.fast_path === true,
    skipLlmRerank: args.skip_llm_rerank === true,
  })
  return {
    query,
    answer: result.answer,
    source_count: result.sources?.length ?? 0,
    sources: (result.sources ?? []).slice(0, 8).map((s) => ({
      title: s.title,
      path: s.path,
      score: s.score,
    })),
  }
}

export async function handleRagMcpRequest(body: McpJsonRpcRequest) {
  if (!isRagMcpServerEnabled()) {
    return mcpErr(body.id, -32000, 'MCP server disabled (RAG_MCP_SERVER=0)')
  }

  const method = String(body.method ?? '').trim()
  const params = (body.params ?? {}) as Record<string, unknown>

  if (method === 'initialize') {
    return mcpOk(body.id, {
      protocolVersion: '2024-11-05',
      serverInfo: { name: 'rag', version: '1.0.0' },
      capabilities: { tools: {} },
    })
  }
  if (method === 'ping') return mcpOk(body.id, {})
  if (method === 'tools/list') return mcpOk(body.id, { tools: TOOLS })

  if (method === 'tools/call') {
    const { name, args } = parseMcpToolCallParams(params)
    try {
      if (name === 'retrieve') return mcpOk(body.id, mcpTextResult(await retrieveTool(args)))
      if (name === 'health') {
        return mcpOk(body.id, mcpTextResult({ service: 'rag', export: true }))
      }
      return mcpErr(body.id, -32601, `unknown tool: ${name}`)
    } catch (e: unknown) {
      return mcpErr(body.id, -32000, String((e as Error)?.message ?? e ?? 'tool failed'))
    }
  }

  return mcpErr(body.id, -32601, `unknown method: ${method}`)
}

