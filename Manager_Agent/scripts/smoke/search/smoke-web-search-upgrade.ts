/**
 * 联网能力 smoke：付费 API 保守默认、直答 gate、SERP 格式化。
 */
import { resolveNeedsWebSearch, formatSerpContextForPrompt } from '../../../server/utils/search/managerWebSearch'
import {
  canCandidateWebDirectSynth,
  isWebDirectSynthEnabled
} from '../../../server/utils/search/managerWebDirectSynthLlm'
import { resolveWebSearchMode, tavilySearchDepth, searchIncludeAnswer } from '../../../server/utils/search/webSearchTool'
import { searchMaxQueriesPerRound, searchResultsPerQuery, searchMaxHits } from '../../../server/utils/search/managerSearchConfig'
import { buildSerpDirectSynthBlock } from '../../../server/utils/search/managerWebDirectSynth'
import { shouldSkipWebSearchStructurally } from '#agent-shared/deterministicPassthrough'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

const saved = { ...process.env }
try {
  delete process.env.SEARXNG_BASE_URL
  delete process.env.WEB_SEARCH_PROVIDER
  delete process.env.MANAGER_WEB_SEARCH_OPEN
  delete process.env.MANAGER_WEB_DIRECT_SYNTH
  delete process.env.TAVILY_API_KEY
  delete process.env.SERPER_API_KEY

  assert(!isWebDirectSynthEnabled(), 'web direct synth default off without searxng')
  assert(tavilySearchDepth() === 'basic', 'tavily depth default basic')
  assert(!searchIncludeAnswer(), 'include_answer default off')
  assert(resolveWebSearchMode() === 'general', 'search mode default general')
  assert(searchMaxQueriesPerRound() === 2, 'max queries default 2')
  assert(searchResultsPerQuery() === 3, 'results per query default 3')
  assert(searchMaxHits() === 8, 'max hits default 8')
} finally {
  process.env = saved
}

const routeWeb = resolveNeedsWebSearch({
  llmNeedsWebSearch: true,
  intent: 'crawler',
  allowedAgents: ['crawler'],
  userText: '今天美元兑人民币汇率是多少'
})
assert(routeWeb.needsWebSearch && routeWeb.reason === 'route_llm', 'route llm only')

const dbSkip = resolveNeedsWebSearch({
  llmNeedsWebSearch: false,
  intent: 'db',
  allowedAgents: ['db'],
  userText: '今天美元兑人民币汇率是多少'
})
assert(!dbSkip.needsWebSearch, 'db route must not auto web without router flag')

assert(
  shouldSkipWebSearchStructurally({ allowedAgents: ['db'], intent: 'db' }) !== null,
  'db skips web search structurally'
)

assert(
  !canCandidateWebDirectSynth({
    intent: 'multi',
    allowedAgents: ['crawler', 'code'],
    needsWebSearch: true,
    searchHits: [{ title: 't', url: 'https://a.com', snippet: 'x' }]
  }),
  'multi with code cannot direct synth'
)

const hits = [{ title: 'USD/CNY', url: 'https://example.com/fx', snippet: '7.25' }]
const block = buildSerpDirectSynthBlock({ searchHits: hits })
assert(block.includes('[1]'), 'serp synth block')

const ctx = formatSerpContextForPrompt(hits)
assert(ctx.includes('[1]'), 'formatted serp context')

console.log('smoke-web-search-upgrade ok')
