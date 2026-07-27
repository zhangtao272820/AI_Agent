/**
 * 统一运行模式：对外一个 EXTRACTOR_MODE，对内映射 planner + agent 双轨。
 *
 * adaptive（推荐）：规则保底 + LLM 补未知站点；HTTP/API 优先，失败再浏览器/MCP。
 * fast：省 token，几乎不走 LLM 规划（已知站点仍走专用解析）。
 * deep：全 LLM 规划 + 强制浏览器，成本高，仅调试泛化能力时用。
 */
import type { AgentConfig } from '../services/crawlerAgentTypes'

export type ExtractorMode = 'adaptive' | 'fast' | 'deep'

export type ResolvedExtractorModes = {
  extractorMode: ExtractorMode
  plannerMode: 'auto' | 'llm' | 'heuristic'
  agentMode: 'smart' | 'llm' | 'rules'
  label: string
}

const MODE_MAP: Record<ExtractorMode, Omit<ResolvedExtractorModes, 'extractorMode'>> = {
  adaptive: {
    plannerMode: 'auto',
    agentMode: 'smart',
    label: '自适应（规则+LLM 规划，HTTP/API 优先，质量不足自动浏览器重试）',
  },
  fast: {
    plannerMode: 'heuristic',
    agentMode: 'rules',
    label: '快速（规则规划，HTTP/站点 API 优先，最省 token）',
  },
  deep: {
    plannerMode: 'llm',
    agentMode: 'llm',
    label: '深度（LLM 规划 + 浏览器渲染，成本高）',
  },
}

function parseExtractorMode(raw: string): ExtractorMode | null {
  const m = String(raw ?? '').trim().toLowerCase()
  if (m === 'adaptive' || m === 'smart' || m === 'auto') return 'adaptive'
  if (m === 'fast' || m === 'economy' || m === 'rules') return 'fast'
  if (m === 'deep' || m === 'llm' || m === 'full') return 'deep'
  return null
}

/** 解析最终 planner/agent 模式；EXTRACTOR_MODE 优先，旧变量 PLANNER_MODE/AGENT_MODE 可覆盖细项。 */
export function resolveExtractorModes(env: NodeJS.ProcessEnv = process.env): ResolvedExtractorModes {
  const unified = parseExtractorMode(String(env.EXTRACTOR_MODE ?? 'adaptive'))
  const base = MODE_MAP[unified ?? 'adaptive']

  const plannerOverride = String(env.PLANNER_MODE ?? '').trim().toLowerCase()
  const agentOverride = String(env.AGENT_MODE ?? '').trim().toLowerCase()

  const plannerMode =
    plannerOverride === 'auto' || plannerOverride === 'llm' || plannerOverride === 'heuristic'
      ? plannerOverride
      : base.plannerMode

  const agentMode =
    agentOverride === 'smart' || agentOverride === 'llm' || agentOverride === 'rules'
      ? agentOverride
      : base.agentMode

  const extractorMode = unified ?? 'adaptive'
  return {
    extractorMode,
    plannerMode,
    agentMode,
    label: MODE_MAP[extractorMode].label,
  }
}

/** 合并进 runtime config，供 workflow / frontload 读取。 */
export function applyExtractorModesToConfig(config: AgentConfig): AgentConfig {
  const modes = resolveExtractorModes()
  return {
    ...config,
    plannerMode: modes.plannerMode,
    agentMode: modes.agentMode,
    extractorMode: modes.extractorMode,
  } as AgentConfig & { extractorMode?: ExtractorMode }
}

/** 单次请求覆盖 EXTRACTOR_MODE（UI / 总管透传）。 */
export function applyExtractorModeOverride(config: AgentConfig, raw?: string): AgentConfig {
  const mode = parseExtractorMode(String(raw ?? ''))
  if (!mode) return config
  const base = MODE_MAP[mode]
  return {
    ...config,
    extractorMode: mode,
    plannerMode: base.plannerMode,
    agentMode: base.agentMode,
  } as AgentConfig & { extractorMode?: ExtractorMode }
}

export function describeActiveModes(): ResolvedExtractorModes {
  return resolveExtractorModes()
}

export function describeModesFromConfig(config: AgentConfig): ResolvedExtractorModes {
  const mode = (config as AgentConfig & { extractorMode?: ExtractorMode }).extractorMode
  if (mode && MODE_MAP[mode]) {
    return {
      extractorMode: mode,
      plannerMode: config.plannerMode ?? MODE_MAP[mode].plannerMode,
      agentMode: config.agentMode ?? MODE_MAP[mode].agentMode,
      label: MODE_MAP[mode].label,
    }
  }
  return {
    extractorMode: mode ?? resolveExtractorModes().extractorMode,
    plannerMode: config.plannerMode ?? resolveExtractorModes().plannerMode,
    agentMode: config.agentMode ?? resolveExtractorModes().agentMode,
    label: resolveExtractorModes().label,
  }
}
