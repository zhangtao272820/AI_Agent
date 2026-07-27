/**
 * 文件用途：MCP（Model Context Protocol）客户端工具适配层。
 *
 * 主要职责：
 * - 根据运行时配置 mcpServers 连接一个或多个 MCP Server（stdio / streamable-http / sse）。
 * - 读取 MCP Server 暴露的 tools 列表，并映射为 LangChain DynamicTool 供 Agent 调用。
 * - 统一处理输入参数：支持 JSON 字符串（对象/数组）或普通文本（包装为 { input }）。
 *
 * 设计约束：
 * - MCP tools 的名称会被规范化为：mcp_<server>__<tool>，便于在 Agent 工具列表中区分来源。
 * - 本文件仅负责“工具接入”，不直接决定业务输出格式；最终回复仍需走输出清洗（避免表名/ID/敏感字段）。
 */
import { DynamicTool } from "@langchain/core/tools";

type McpServerConfig =
  | { type?: "stdio"; command: string; args?: string[]; env?: Record<string, string> }
  | { type: "streamable-http" | "sse"; url: string; headers?: Record<string, string> };

type McpServersConfig = Record<string, McpServerConfig>;

type McpClientConn = { client: any; close: () => Promise<void> };

const clientConnByName = new Map<string, Promise<McpClientConn>>();
const toolCacheByName = new Map<string, Promise<any[]>>();

function safeJsonParse(text: string) {
  const t = String(text ?? "").trim();
  if (!t) return null;
  if (!(t.startsWith("{") || t.startsWith("["))) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

async function connectServer(name: string, cfg: McpServerConfig): Promise<McpClientConn> {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const client = new Client({ name: `ai-agent-admin:${name}`, version: "1.0.0" });
  if ((cfg as any).type === "streamable-http") {
    const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
    const transport = new StreamableHTTPClientTransport(new URL((cfg as any).url), { headers: (cfg as any).headers });
    await client.connect(transport);
    return { client, close: async () => await client.close() };
  }
  if ((cfg as any).type === "sse") {
    const { SSEClientTransport } = await import("@modelcontextprotocol/sdk/client/sse.js");
    const transport = new SSEClientTransport(new URL((cfg as any).url));
    await client.connect(transport);
    return { client, close: async () => await client.close() };
  }
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  const transport = new StdioClientTransport({
    command: (cfg as any).command,
    args: Array.isArray((cfg as any).args) ? (cfg as any).args : [],
    env: (cfg as any).env,
  });
  await client.connect(transport);
  return { client, close: async () => await client.close() };
}

async function listServerTools(serverName: string, cfg: McpServerConfig) {
  const conn = await (clientConnByName.get(serverName) ??
    clientConnByName.set(serverName, connectServer(serverName, cfg)).get(serverName)!);
  const resp = await conn.client.listTools();
  const tools = Array.isArray(resp?.tools) ? resp.tools : [];
  return tools;
}

function toLcToolName(serverName: string, toolName: string) {
  const s = String(serverName || "").trim().replace(/[^\w.-]+/g, "_");
  const t = String(toolName || "").trim().replace(/[^\w.-]+/g, "_");
  return `mcp_${s}__${t}`.slice(0, 64);
}

function extractToolText(result: any) {
  const content = result?.content;
  if (Array.isArray(content)) {
    const texts = content.map((c: any) => (c?.type === "text" ? String(c?.text ?? "") : "")).filter(Boolean);
    if (texts.length > 0) return texts.join("\n");
  }
  if (result?.structuredContent !== undefined) {
    try {
      return JSON.stringify(result.structuredContent, null, 2);
    } catch {}
  }
  return typeof result === "string" ? result : JSON.stringify(result ?? "");
}

export async function createMcpTools(params: { mcpServers?: McpServersConfig | null | undefined }) {
  const entries = Object.entries(params.mcpServers ?? {}).filter(([k, v]) => k && v);
  if (entries.length === 0) return [];
  const lcTools: DynamicTool[] = [];
  for (const [serverName, cfg] of entries) {
    const toolsPromise =
      toolCacheByName.get(serverName) ?? toolCacheByName.set(serverName, listServerTools(serverName, cfg)).get(serverName)!;
    let tools: any[] = [];
    try {
      tools = await toolsPromise;
    } catch {
      continue;
    }
    for (const t of tools) {
      const toolName = String(t?.name ?? "").trim();
      if (!toolName) continue;
      const title = String(t?.title ?? "").trim();
      const description = String(t?.description ?? "").trim();
      const lcName = toLcToolName(serverName, toolName);
      lcTools.push(
        new DynamicTool({
          name: lcName,
          description: [title || toolName, description ? `说明：${description}` : "", `来源：${serverName}`]
            .filter(Boolean)
            .join("\n"),
          func: async (input: string) => {
            const conn = await (clientConnByName.get(serverName) ??
              clientConnByName.set(serverName, connectServer(serverName, cfg)).get(serverName)!);
            const parsed = safeJsonParse(input);
            const args = parsed && typeof parsed === "object" ? parsed : { input: String(input ?? "") };
            const result = await conn.client.callTool({ name: toolName, arguments: args });
            return extractToolText(result);
          },
        }),
      );
    }
  }
  return lcTools;
}
