/**
 * 联网检索档位：用 MANAGER_WEB_SEARCH_MODE 替代多组 0/1 开关。
 */

export type WebSearchModeTier = 'off' | 'economy' | 'open'

export function isSearxngSearchConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const provider = String(env.WEB_SEARCH_PROVIDER ?? '').trim().toLowerCase()
  if (provider === 'searxng') return true
  return String(env.SEARXNG_BASE_URL ?? '').trim().length > 0
}

function hasPaidSearchApiKey(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    String(env.TAVILY_API_KEY ?? '').trim().length > 0 ||
    String(env.SERPER_API_KEY ?? '').trim().length > 0
  )
}

function legacyWebSearchEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env.MANAGER_WEB_SEARCH ?? '1').trim().toLowerCase()
  return !(v === '0' || v === 'false' || v === 'off' || v === 'no')
}

function parseModeToken(raw: string): WebSearchModeTier | null {
  const v = String(raw ?? '').trim().toLowerCase()
  if (!v) return null
  if (v === 'off' || v === '0' || v === 'false' || v === 'no') return 'off'
  if (v === 'economy' || v === 'paid' || v === 'conservative' || v === 'save') return 'economy'
  if (v === 'open' || v === 'full' || v === 'searxng' || v === '1' || v === 'true' || v === 'on') return 'open'
  return null
}

/** 解析联网档位（显式 MANAGER_WEB_SEARCH_MODE > 旧开关 > 按 provider 推断） */
export function resolveWebSearchModeTier(env: NodeJS.ProcessEnv = process.env): WebSearchModeTier {
  const explicit = parseModeToken(String(env.MANAGER_WEB_SEARCH_MODE ?? ''))
  if (explicit) return explicit

  if (String(env.MANAGER_WEB_SEARCH ?? '1').trim() === '0') return 'off'

  const openLegacy = String(env.MANAGER_WEB_SEARCH_OPEN ?? '').trim().toLowerCase()
  if (openLegacy === '1' || openLegacy === 'true' || openLegacy === 'on') return 'open'
  if (openLegacy === '0' || openLegacy === 'false' || openLegacy === 'off') return 'economy'

  if (isSearxngSearchConfigured(env)) return 'open'
  if (hasPaidSearchApiKey(env)) return 'economy'
  return 'off'
}

export function isWebSearchEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (String(env.MANAGER_WEB_SEARCH_MODE ?? '').trim()) {
    return resolveWebSearchModeTier(env) !== 'off'
  }
  return legacyWebSearchEnabled(env)
}

export function isWebSearchOpenTier(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveWebSearchModeTier(env) === 'open'
}

/** @deprecated 请用 isWebSearchOpenTier / resolveWebSearchModeTier */
export function isSelfHostedWebSearch(env: NodeJS.ProcessEnv = process.env): boolean {
  return isWebSearchOpenTier(env)
}

/** 模式默认 + 单项 env 可覆盖 */
export function webSearchFlag(
  envName: string,
  openDefault: boolean,
  economyDefault: boolean,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const raw = env[envName]
  if (raw !== undefined && String(raw).trim() !== '') {
    return String(raw).trim() !== '0'
  }
  const tier = resolveWebSearchModeTier(env)
  if (tier === 'off') return false
  if (tier === 'open') return openDefault
  return economyDefault
}

export const WEB_SEARCH_MODE_PRESETS = {
  open: {
    loop: true,
    verify: true,
    verifyLlm: true,
    directSynth: true,
    directSynthLlm: true,
    chatWeb: true,
    maxRounds: 3,
    maxQueries: 3,
    resultsPerQuery: 5,
    maxHits: 12,
    maxSeeds: 8,
    maxSeedsPerDomain: 2
  },
  economy: {
    loop: false,
    verify: false,
    verifyLlm: false,
    directSynth: false,
    directSynthLlm: true,
    chatWeb: true,
    maxRounds: 2,
    maxQueries: 2,
    resultsPerQuery: 3,
    maxHits: 8,
    maxSeeds: 5,
    maxSeedsPerDomain: 1
  }
} as const

export function webSearchPresetInt(
  envName: string,
  key: keyof typeof WEB_SEARCH_MODE_PRESETS.open,
  env: NodeJS.ProcessEnv = process.env
): number {
  const raw = env[envName]
  if (raw !== undefined && String(raw).trim() !== '') {
    return Number(raw)
  }
  const tier = resolveWebSearchModeTier(env)
  if (tier === 'off') return WEB_SEARCH_MODE_PRESETS.economy[key] as number
  const preset = tier === 'open' ? WEB_SEARCH_MODE_PRESETS.open : WEB_SEARCH_MODE_PRESETS.economy
  return preset[key] as number
}
