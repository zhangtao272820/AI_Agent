/**
 * 联网内容进 Synth：crawler 摘要解析 + 对照任务不走 SERP-only 短路。
 */
import { parseSourceSnapshots } from '#agent-shared/cleanPayload'
import { extractStructuredPayload } from '../../../server/graph/core/shared'
import { buildSerpOnlyCrawlerOutcome } from '../../../server/utils/crawler/managerCrawlerTaskPayload'
import { inferSerpOnlyStructural } from '../../../server/utils/crawler/managerCrawlerSerpOnlyLlm'
import { extractCrawlerItemsFromText } from '../../../server/utils/crawler/crawlerItemsParse'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

const crawlerOut = buildSerpOnlyCrawlerOutcome(
  {
    searchHits: [
      {
        title: '足底压力参考区间',
        url: 'https://example.com/guide',
        snippet: '正常成人足弓指数参考约 0.21-0.26'
      }
    ]
  },
  '检索足底压力参考区间'
)
assert(crawlerOut?.output && !crawlerOut.output.includes('403/拦截'), 'serp-only note must not claim 403')
assert(crawlerOut.output.includes('联网检索摘要'), 'serp-only note')

const snaps = parseSourceSnapshots({ crawler: crawlerOut!.output }, extractStructuredPayload)
assert(snaps.length === 1 && snaps[0]!.facts.length >= 1, 'crawler markdown → clean facts')

const items = extractCrawlerItemsFromText(crawlerOut!.output)
assert(items.length >= 1, 'crawler items parsed from markdown')

const comparison = inferSerpOnlyStructural(
  '从数据库取出足底压力，再从公开网站检索参考区间对照后生成报告',
  { serpContext: 'hit', searchHits: [{}] }
)
assert(comparison?.serpOnly !== true, 'comparison without webMode must not force structural serp-only')

console.log('smoke-crawler-synth-context ok')
