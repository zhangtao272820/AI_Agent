/**
 * SearXNG provider 解析 smoke（无需真实 SearXNG 实例）。
 */
import {
  hasConfiguredSearchBackend,
  isSearxngSearchConfigured,
  resolveSearxngBaseUrl,
  resolveWebSearchProvider,
  webSearchProviderFallbackChain
} from '../../../server/utils/search/webSearchTool'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

const prev = { ...process.env }

try {
  process.env.WEB_SEARCH_PROVIDER = 'searxng'
  process.env.SEARXNG_BASE_URL = 'http://searxng:8080'
  delete process.env.TAVILY_API_KEY
  delete process.env.SERPER_API_KEY

  assert(resolveWebSearchProvider() === 'searxng', 'provider=searxng')
  assert(isSearxngSearchConfigured(), 'searxng configured')
  assert(hasConfiguredSearchBackend(), 'backend configured')
  assert(resolveSearxngBaseUrl() === 'http://searxng:8080', 'base url trimmed')
  assert(webSearchProviderFallbackChain()[0] === 'searxng', 'fallback chain starts searxng')
} finally {
  process.env = prev
}

console.log('smoke-searxng ok')
