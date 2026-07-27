/**
 * P2：MCP Tool Registry — Planner 动态发现外部 MCP 工具
 */

import { agentPgQuery, isAgentPgConfigured } from './agentPgClient'

export type McpToolEntry = {
  serverName: string
  toolName: string
  description: string
  agentHint?: string
  risk: 'low' | 'medium' | 'high'
  enabled: boolean
  source: string
}

export function isMcpRegistryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.MGR_MCP_REGISTRY ?? '1').trim() !== '0'
}

function parseEnvRegistry(env: NodeJS.ProcessEnv): McpToolEntry[] {
  const raw = String(env.MGR_MCP_REGISTRY_JSON ?? '').trim()
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const out: McpToolEntry[] = []
    for (const row of parsed) {
      if (!row || typeof row !== 'object') continue
      const r = row as Record<string, unknown>
      const serverName = String(r.server ?? r.serverName ?? 'default').trim()
      const tools = Array.isArray(r.tools) ? r.tools : [r]
      for (const t of tools) {
        if (!t || typeof t !== 'object') continue
        const tool = t as Record<string, unknown>
        const toolName = String(tool.name ?? tool.toolName ?? '').trim()
        if (!toolName) continue
        out.push({
          serverName,
          toolName,
          description: String(tool.description ?? '').trim().slice(0, 240),
          agentHint: String(tool.agent ?? tool.agentHint ?? '').trim() || undefined,
          risk: (['low', 'medium', 'high'].includes(String(tool.risk)) ? String(tool.risk) : 'medium') as McpToolEntry['risk'],
          enabled: tool.enabled !== false,
          source: 'env'
        })
      }
    }
    return out
  } catch {
    return []
  }
}

function builtinRegistryHints(env: NodeJS.ProcessEnv): McpToolEntry[] {
  const out: McpToolEntry[] = []
  const lobsterUrl = String(env.LOBSTER_MCP_URL ?? '').trim()
  const lobsterExport = String(env.LOBSTER_MCP_EXPORT ?? '1').trim() !== '0'
  const guiHttp = String(env.LOBSTER_AGENT_WS_URL ?? '').trim()
  if (lobsterUrl || lobsterExport) {
    out.push(
      {
        serverName: 'lobster-gui',
        toolName: 'run_browser_task',
        description: 'Lobster GUI：执行浏览器任务（MCP export）',
        agentHint: 'gui',
        risk: 'medium',
        enabled: lobsterExport,
        source: 'builtin',
      },
      {
        serverName: 'lobster-gui',
        toolName: 'browser_snapshot',
        description: 'Lobster GUI：页面快照',
        agentHint: 'gui',
        risk: 'low',
        enabled: lobsterExport,
        source: 'builtin',
      },
    )
  }
  if (lobsterUrl) {
    out.push(
      {
        serverName: 'playwright_mcp',
        toolName: 'browser_navigate',
        description: 'Lobster Playwright MCP：打开 URL',
        agentHint: 'gui',
        risk: 'medium',
        enabled: true,
        source: 'builtin',
      },
      {
        serverName: 'playwright_mcp',
        toolName: 'browser_snapshot',
        description: 'Lobster Playwright MCP：无障碍树快照',
        agentHint: 'gui',
        risk: 'low',
        enabled: true,
        source: 'builtin',
      },
    )
  }
  if (String(env.CODE_MCP_SERVER ?? '0').trim() === '1') {
    out.push(
      {
        serverName: 'code-assist',
        toolName: 'read_file',
        description: 'Code Assist：读仓库文件',
        agentHint: 'code',
        risk: 'low',
        enabled: true,
        source: 'builtin',
      },
      {
        serverName: 'code-assist',
        toolName: 'apply_patch',
        description: 'Code Assist：受控写文件',
        agentHint: 'code',
        risk: 'high',
        enabled: true,
        source: 'builtin',
      },
    )
  }
  if (String(env.RAG_MCP_SERVER ?? '0').trim() === '1') {
    out.push({
      serverName: 'rag',
      toolName: 'retrieve',
      description: 'RAG：混合检索',
      agentHint: 'rag',
      risk: 'low',
      enabled: true,
      source: 'builtin',
    })
  }
  if (String(env.ADMIN_MCP_ENABLED ?? '').trim() === '1') {
    out.push({
      serverName: 'admin_mcp',
      toolName: 'mcp_*',
      description: 'Admin Agent 已启用 MCP 工具探测（mcp_* 前缀）',
      agentHint: 'admin',
      risk: 'high',
      enabled: true,
      source: 'builtin'
    })
  }
  return out
}

export async function loadMcpToolRegistry(env: NodeJS.ProcessEnv = process.env): Promise<McpToolEntry[]> {
  if (!isMcpRegistryEnabled(env)) return []

  const merged = new Map<string, McpToolEntry>()
  for (const e of [...builtinRegistryHints(env), ...parseEnvRegistry(env)]) {
    merged.set(`${e.serverName}::${e.toolName}`, e)
  }

  if (isAgentPgConfigured(env)) {
    const res = await agentPgQuery<{
      server_name: string
      tool_name: string
      description: string | null
      agent_hint: string | null
      risk: string
      enabled: boolean
      source: string
    }>(
      `SELECT server_name, tool_name, description, agent_hint, risk, enabled, source
       FROM mgr_mcp_tool_registry
       WHERE enabled = TRUE
       ORDER BY server_name, tool_name
       LIMIT 200`,
      [],
      env
    ).catch(() => null)

    for (const row of res?.rows ?? []) {
      merged.set(`${row.server_name}::${row.tool_name}`, {
        serverName: row.server_name,
        toolName: row.tool_name,
        description: String(row.description ?? '').slice(0, 240),
        agentHint: row.agent_hint ?? undefined,
        risk: (['low', 'medium', 'high'].includes(row.risk) ? row.risk : 'medium') as McpToolEntry['risk'],
        enabled: row.enabled !== false,
        source: row.source || 'pg'
      })
    }
  }

  return [...merged.values()].filter((e) => e.enabled)
}

export function formatMcpRegistryBlockForPlanner(tools: McpToolEntry[]): string {
  if (!tools.length) return ''
  const lines = tools.slice(0, 24).map(
    (t) =>
      `- ${t.serverName}/${t.toolName}（risk=${t.risk}${t.agentHint ? `→${t.agentHint}` : ''}）${t.description ? `：${t.description}` : ''}`
  )
  return ['### MCP 工具注册表（Planner 可选用；高风险须 human_confirm）', ...lines].join('\n')
}
