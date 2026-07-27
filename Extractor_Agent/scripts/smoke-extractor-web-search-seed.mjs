/**
 * Extractor 联网种子契约：组装 manager_task_json + 已有种子时跳过重复搜索。
 */
import {
  buildExtractorUiManagerTaskJson,
  formatExtractorSerpContext,
  isNetworkRequested,
  managerTaskAlreadyHasSeeds,
} from '../server/utils/extractor_web_search.ts'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

const hits = [
  {
    title: '足底压力参考',
    url: 'https://example.com/guide',
    snippet: '正常成人足弓指数参考约 0.21-0.26',
  },
  {
    title: '指南摘要',
    url: 'https://example.org/ref',
    snippet: '公开参考区间',
  },
  {
    title: '教程应被过滤',
    url: 'https://blog.csdn.net/x/article/1',
    snippet: 'python爬取',
  },
]

const json = buildExtractorUiManagerTaskJson({ task: '检索足底压力参考区间并抓取正文', hits })
const payload = JSON.parse(json)

assert(payload.source === 'extractor_ui', 'source')
assert(payload.crawl_strategy === 'crawl_seeds', 'crawl_strategy')
assert(Array.isArray(payload.seed_urls) && payload.seed_urls.length >= 1, 'seed_urls')
assert(!payload.seed_urls.some((u) => /csdn/i.test(u)), 'csdn filtered from seeds')
assert(Array.isArray(payload.serp_hits) && payload.serp_hits.length >= 1, 'serp_hits')
assert(String(payload.serp_context || '').includes('example.com'), 'serp_context')
assert(managerTaskAlreadyHasSeeds(json) === true, 'already has seeds')
assert(managerTaskAlreadyHasSeeds('') === false, 'empty has no seeds')
assert(managerTaskAlreadyHasSeeds('{"seed_urls":[]}') === false, 'empty seed_urls')
assert(
  managerTaskAlreadyHasSeeds('{"source":"manager","open_web_discovery":true}') === true,
  'respect manager source package'
)

const ctx = formatExtractorSerpContext(hits.filter((h) => !/csdn/i.test(h.url)))
assert(ctx.includes('URL: https://example.com/guide'), 'format context url')

assert(isNetworkRequested({ network: true }) === true, 'network true')
assert(isNetworkRequested({ network: false }) === false, 'network false')
assert(isNetworkRequested({}, false) === false, 'explicit false')
assert(isNetworkRequested({}, true) === true, 'explicit true')

console.log('smoke-extractor-web-search-seed ok')
