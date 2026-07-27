/**
 * MANAGER_WEB_SEARCH_MODE 档位 smoke。
 */
import {
  resolveWebSearchModeTier,
  isWebSearchOpenTier,
  webSearchFlag
} from '../../../server/utils/search/managerWebSearchMode'
import {
  isSearchLoopEnabled,
  isSearchVerifyEnabled,
  maxSearchRounds
} from '../../../server/utils/search/managerSearchVerifier'
import { isSearchVerifyLlmEnabled } from '../../../server/utils/search/managerSearchVerifierLlm'
import { isWebDirectSynthEnabled } from '../../../server/utils/search/managerWebDirectSynthLlm'
import {
  searchMaxHits,
  searchMaxQueriesPerRound,
  searchResultsPerQuery,
  searchMaxSeeds
} from '../../../server/utils/search/managerSearchConfig'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

function withEnv(patch: Record<string, string | undefined>, fn: () => void) {
  const prev = { ...process.env }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  try {
    fn()
  } finally {
    process.env = prev
  }
}

withEnv(
  {
    MANAGER_WEB_SEARCH_MODE: 'economy',
    SEARXNG_BASE_URL: undefined,
    WEB_SEARCH_PROVIDER: 'tavily',
    TAVILY_API_KEY: 'x'
  },
  () => {
    assert(resolveWebSearchModeTier() === 'economy', 'economy mode')
    assert(!isSearchVerifyEnabled(), 'economy: verify off')
    assert(!isWebDirectSynthEnabled(), 'economy: direct synth off')
    assert(searchMaxQueriesPerRound() === 2, 'economy: queries 2')
  }
)

withEnv(
  {
    MANAGER_WEB_SEARCH_MODE: 'open',
    WEB_SEARCH_PROVIDER: 'searxng',
    SEARXNG_BASE_URL: 'http://searxng:8080'
  },
  () => {
    assert(isWebSearchOpenTier(), 'open tier')
    assert(isSearchVerifyEnabled(), 'open: verify on')
    assert(isSearchLoopEnabled(), 'open: loop on')
    assert(isSearchVerifyLlmEnabled(), 'open: verify llm on')
    assert(isWebDirectSynthEnabled(), 'open: direct synth on')
    assert(webSearchFlag('MANAGER_CHAT_WEB', true, true), 'open: chat web')
    assert(maxSearchRounds() === 3, 'open: rounds 3')
    assert(searchMaxQueriesPerRound() === 3, 'open: queries 3')
    assert(searchResultsPerQuery() === 5, 'open: results 5')
    assert(searchMaxHits() === 12, 'open: hits 12')
    assert(searchMaxSeeds() === 8, 'open: seeds 8')
  }
)

console.log('smoke-web-search-open ok')
