import { getExtractorAgentEnv } from '../../utils/extractor_agent_env'

/** 单次任务 MCP 调用预算（防 Verifier/Worker 循环烧额度） */
export function getMcpMaxCalls(options?: Record<string, unknown> | null): number {
  const n = Number(options?.__mcpMaxCalls)
  if (Number.isFinite(n) && n >= 0) return Math.floor(n)
  return getExtractorAgentEnv().mcpMaxCallsDefault
}

export function countMcpCallsInTrace(options?: Record<string, unknown> | null): number {
  const trace = Array.isArray(options?.__channelTrace) ? options.__channelTrace : []
  return trace.filter((e) => String((e as any)?.channel ?? '') === 'mcp').length
}

export function canInvokeMcp(options?: Record<string, unknown> | null, extraReserved = 0): boolean {
  const max = getMcpMaxCalls(options)
  if (max <= 0) return false
  const used = Number(options?.__mcpCallsUsed ?? countMcpCallsInTrace(options))
  return used + extraReserved < max
}

export function markMcpCallUsed(options?: Record<string, unknown> | null) {
  if (!options || typeof options !== 'object') return
  const used = Number(options.__mcpCallsUsed ?? countMcpCallsInTrace(options))
  options.__mcpCallsUsed = used + 1
}

export function channelTraceHas(options: Record<string, unknown> | null | undefined, channel: string): boolean {
  const trace = Array.isArray(options?.__channelTrace) ? options.__channelTrace : []
  return trace.some((e) => String((e as any)?.channel ?? '') === channel)
}
