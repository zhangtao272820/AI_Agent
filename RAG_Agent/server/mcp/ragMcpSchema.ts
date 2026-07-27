import type { McpToolDescriptor } from '#agent-shared/mcpJsonRpc'

export function isRagMcpServerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.RAG_MCP_SERVER ?? '0').trim() === '1'
}

export const RAG_MCP_TOOLS: McpToolDescriptor[] = [
  {
    name: 'retrieve',
    description: '向量+词法混合检索，返回 snippets 与 answer 摘要',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        fast_path: { type: 'boolean' },
        skip_llm_rerank: { type: 'boolean' },
      },
      required: ['query'],
    },
  },
  {
    name: 'health',
    description: 'RAG MCP 服务状态',
    inputSchema: { type: 'object', properties: {} },
  },
]
