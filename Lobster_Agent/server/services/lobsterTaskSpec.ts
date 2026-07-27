/**
 * TaskSpec 驱动的引擎链与填表优先策略（替代 regex 意图）
 */
import type { LobsterEngineId } from './engineSelector'
import { engineFallbackChain } from './engineSelector'
import { recipePreferredEngine, recipeRequiresHeadedInDocker } from './siteRecipes'
import { requiresClassicEngine, requiresDesktopEngine, requiresMobileEngine } from './engineSelector'
import type { LobsterBrowserProfile, LobsterTaskSpec } from './lobsterTaskUnderstandSchema'
import { isUserBrowserProfile } from './browserProfiles'
import { isLobsterMcpHeadlessSidecar } from '../utils/lobster_env'

/** 引擎选型结果（原 engineClassifierLlm 类型；选型真路径为本文件 resolveEngineFromTaskSpec） */
export type EngineClassifierResult = {
  engine: LobsterEngineId
  confidence: number
  reason: string
  source: 'forced' | 'recipe' | 'llm' | 'regex'
}

export function reorderChainForTaskSpec(
  chain: LobsterEngineId[],
  spec: LobsterTaskSpec | undefined,
  hasStorage: boolean,
): LobsterEngineId[] {
  const needsForm =
    spec?.task_kind === 'form_fill' ||
    spec?.task_kind === 'login' ||
    spec?.needs_login === true
  if (!hasStorage || !needsForm) return chain
  if (!chain.includes('stagehand')) return chain
  return ['stagehand', ...chain.filter((e) => e !== 'stagehand')]
}

export function resolveEngineFromTaskSpec(input: {
  spec?: LobsterTaskSpec | null
  task: string
  startUrl?: string
  engineHint?: string
  hasStorage?: boolean
}): EngineClassifierResult {
  const forced = String(input.engineHint || '').trim().toLowerCase()
  if (forced === 'classic' || forced === 'mcp' || forced === 'stagehand' || forced === 'desktop' || forced === 'mobile') {
    return { engine: forced, confidence: 1, reason: 'engine_hint', source: 'forced' }
  }

  if (requiresMobileEngine(input.task, input.startUrl) || input.spec?.task_kind === 'mobile_app') {
    return {
      engine: 'mobile',
      confidence: 0.9,
      reason: 'hard_guard: mobile_app / Android',
      source: 'regex',
    }
  }

  if (requiresDesktopEngine(input.task, input.startUrl) || input.spec?.task_kind === 'desktop_app') {
    return {
      engine: 'desktop',
      confidence: 0.92,
      reason: 'hard_guard: desktop_app / 原生应用',
      source: 'regex',
    }
  }

  if (requiresClassicEngine(input.task, input.startUrl) || input.spec?.task_kind === 'video_play') {
    return {
      engine: 'classic',
      confidence: 0.95,
      reason: 'hard_guard: video_play / B站互动需 classic',
      source: 'regex',
    }
  }

  const spec = input.spec
  if (spec && spec.confidence >= 0.5 && spec.engine_hint !== 'auto') {
    return {
      engine: spec.engine_hint as LobsterEngineId,
      confidence: spec.confidence,
      reason: spec.rationale || 'task_understand',
      source: spec.source === 'llm' ? 'llm' : 'forced',
    }
  }

  const recipeEngine = recipePreferredEngine(input.task, input.startUrl)
  if (recipeEngine) {
    return {
      engine: recipeEngine,
      confidence: 0.88,
      reason: `site_recipe:${recipeEngine}`,
      source: 'recipe',
    }
  }

  if (spec?.task_kind === 'form_fill' || spec?.task_kind === 'login' || spec?.needs_login) {
    return { engine: 'stagehand', confidence: 0.75, reason: 'task_kind_form/login', source: 'llm' }
  }
  if (spec?.task_kind === 'search' || spec?.task_kind === 'extract' || spec?.task_kind === 'navigate') {
    return { engine: 'mcp', confidence: 0.72, reason: 'task_kind_search/extract', source: 'llm' }
  }

  return { engine: 'mcp', confidence: 0.55, reason: 'default_mcp', source: 'regex' }
}

export function buildEngineChainFromPick(picked: EngineClassifierResult): LobsterEngineId[] {
  return picked.source === 'forced' ? [picked.engine] : engineFallbackChain(picked.engine)
}

/**
 * user profile + CDP：classic 可附着已登录 Chrome，MCP sidecar 为隔离浏览器 → 优先 classic
 */
export function reorderChainForBrowserProfile(
  chain: LobsterEngineId[],
  profile: LobsterBrowserProfile | undefined,
): LobsterEngineId[] {
  const mode = profile === 'user' ? 'user' : profile === 'managed' ? 'managed' : null
  if (mode !== 'user' || !isUserBrowserProfile()) return chain
  if (!chain.includes('classic')) return chain
  return ['classic', ...chain.filter((e) => e !== 'classic')]
}

/**
 * Docker 无头 MCP sidecar：强风控站点（如百度）或需登录任务优先 classic，便于 noVNC 可见 + 人工过验证码
 */
export function reorderChainForHeadlessMcpSidecar(
  chain: LobsterEngineId[],
  task: string,
  startUrl?: string,
  taskSpec?: LobsterTaskSpec | null,
): LobsterEngineId[] {
  if (!isLobsterMcpHeadlessSidecar()) return chain
  const needsHeaded =
    recipeRequiresHeadedInDocker(task, startUrl) ||
    taskSpec?.needs_login === true ||
    taskSpec?.task_kind === 'login'
  if (!needsHeaded) return chain
  const withClassic = chain.includes('classic') ? chain : [...chain, 'classic']
  return ['classic', ...withClassic.filter((e) => e !== 'classic')]
}
