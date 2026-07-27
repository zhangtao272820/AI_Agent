/**
 * MCP 客户端：连接 Playwright MCP Server，列出 tools 并调用。
 * 与 DB_Agent/utils/mcp.ts 同构，供 lobsterMcpAgent 使用。
 */
import type { McpServerConfig, McpServersConfig } from './lobster_env'

export type McpToolDef = {
  serverName: string
  name: string
  title?: string
  description?: string
  inputSchema?: Record<string, unknown>
}

type McpClientConn = { client: any; close: () => Promise<void> }

const clientConnByName = new Map<string, Promise<McpClientConn>>()
const toolCacheByName = new Map<string, Promise<McpToolDef[]>>()

function safeJsonParse(text: string) {
  const t = String(text ?? '').trim()
  if (!t) return null
  if (!(t.startsWith('{') || t.startsWith('['))) return null
  try {
    return JSON.parse(t)
  } catch {
    return null
  }
}

async function connectServer(name: string, cfg: McpServerConfig): Promise<McpClientConn> {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const client = new Client({ name: `lobster-agent:${name}`, version: '1.0.0' })
  if ((cfg as any).type === 'streamable-http') {
    const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js')
    const transport = new StreamableHTTPClientTransport(new URL((cfg as any).url), {
      headers: (cfg as any).headers
    })
    await client.connect(transport)
    return { client, close: async () => await client.close() }
  }
  if ((cfg as any).type === 'sse') {
    const { SSEClientTransport } = await import('@modelcontextprotocol/sdk/client/sse.js')
    const transport = new SSEClientTransport(new URL((cfg as any).url))
    await client.connect(transport)
    return { client, close: async () => await client.close() }
  }
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js')
  const transport = new StdioClientTransport({
    command: (cfg as any).command,
    args: Array.isArray((cfg as any).args) ? (cfg as any).args : [],
    env: (cfg as any).env
  })
  await client.connect(transport)
  return { client, close: async () => await client.close() }
}

async function getConn(serverName: string, cfg: McpServerConfig): Promise<McpClientConn> {
  return await (clientConnByName.get(serverName) ??
    clientConnByName.set(serverName, connectServer(serverName, cfg)).get(serverName)!)
}

async function invalidateConn(serverName: string) {
  const pending = clientConnByName.get(serverName)
  clientConnByName.delete(serverName)
  toolCacheByName.delete(serverName)
  if (pending) {
    await pending.then((c) => c.close()).catch(() => undefined)
  }
}

function isRetriableMcpConnError(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err ?? '')
  return /Connection closed|ECONNRESET|fetch failed|terminated|socket hang up|502|503/i.test(msg)
}

export function extractMcpToolText(result: any): string {
  const content = result?.content
  if (Array.isArray(content)) {
    const texts = content.map((c: any) => (c?.type === 'text' ? String(c?.text ?? '') : '')).filter(Boolean)
    if (texts.length > 0) return texts.join('\n')
  }
  if (result?.structuredContent !== undefined) {
    try {
      return JSON.stringify(result.structuredContent, null, 2)
    } catch {}
  }
  return typeof result === 'string' ? result : JSON.stringify(result ?? '')
}

export async function listMcpTools(servers: McpServersConfig): Promise<McpToolDef[]> {
  const entries = Object.entries(servers).filter(([k, v]) => k && v)
  const out: McpToolDef[] = []
  for (const [serverName, cfg] of entries) {
    const toolsPromise =
      toolCacheByName.get(serverName) ??
      toolCacheByName.set(
        serverName,
        (async () => {
          const conn = await getConn(serverName, cfg)
          const resp = await conn.client.listTools()
          const tools = Array.isArray(resp?.tools) ? resp.tools : []
          return tools
            .map((t: any) => {
              const name = String(t?.name ?? '').trim()
              if (!name) return null
              return {
                serverName,
                name,
                title: String(t?.title ?? '').trim() || undefined,
                description: String(t?.description ?? '').trim() || undefined,
                inputSchema: t?.inputSchema && typeof t.inputSchema === 'object' ? t.inputSchema : undefined
              } satisfies McpToolDef
            })
            .filter(Boolean) as McpToolDef[]
        })()
      ).get(serverName)!
    try {
      out.push(...(await toolsPromise))
    } catch {
      /* server unavailable */
    }
  }
  return out
}

export async function callMcpTool(
  servers: McpServersConfig,
  serverName: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<string> {
  const cfg = servers[serverName]
  if (!cfg) throw new Error(`unknown mcp server: ${serverName}`)

  const invoke = async () => {
    const conn = await getConn(serverName, cfg)
    const result = await conn.client.callTool({ name: toolName, arguments: args })
    return extractMcpToolText(result)
  }

  try {
    return await invoke()
  } catch (e: unknown) {
    if (!isRetriableMcpConnError(e)) throw e
    await invalidateConn(serverName)
    return await invoke()
  }
}

export async function probeMcpServers(
  servers: McpServersConfig,
  timeoutMs = 12_000
): Promise<{ ok: boolean; toolCount: number; servers: string[]; error?: string }> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const tools = await listMcpTools(servers)
    const serversUp = Array.from(new Set(tools.map((t) => t.serverName)))
    return { ok: tools.length > 0, toolCount: tools.length, servers: serversUp }
  } catch (e: any) {
    return {
      ok: false,
      toolCount: 0,
      servers: [],
      error: e?.message ? String(e.message) : String(e)
    }
  } finally {
    clearTimeout(timer)
  }
}

export async function closeMcpConnections() {
  const closers: Promise<void>[] = []
  for (const p of clientConnByName.values()) {
    closers.push(
      p
        .then((c) => c.close())
        .catch(() => undefined)
    )
  }
  clientConnByName.clear()
  toolCacheByName.clear()
  await Promise.all(closers)
}

export function parseMcpToolArgs(input: unknown): Record<string, unknown> {
  if (input && typeof input === 'object' && !Array.isArray(input)) return input as Record<string, unknown>
  if (typeof input === 'string') {
    const parsed = safeJsonParse(input)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
    const t = input.trim()
    if (t) return { input: t }
  }
  return {}
}
