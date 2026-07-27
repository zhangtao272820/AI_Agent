/**
 * 独立 UI 联网引导：豆瓣等已知站点走官方种子，不塞 CSDN 教程站；
 * seed-first 命中补丁时走 douban_top250，不得落到 manager_seeds 单页摘要。
 */
import {
  buildSiteLockedManagerTaskJson,
  rankExtractorSerpHitsForTask,
} from '../server/utils/extractor_web_search.ts'
import { buildSeedFirstPlan } from '../server/services/crawlerAgentPlan.ts'
import { inferStructuralTaskPlan, mergeStructuralIntoTaskPlan } from '../server/core/plan/structural.ts'
import { buildHeuristicStructuredTaskPlan } from '../server/services/crawlerAgentTaskPlanning.ts'
import { isLowValueTutorialSeedUrl, isValidCrawlSeedUrl } from '../agent-repo-shared/crawlUrlQuality.ts'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

const doubanTask = '帮我爬取豆瓣 top 10 的电影信息'
const locked = buildSiteLockedManagerTaskJson(doubanTask)
assert(locked, 'douban site lock')
assert(locked.site === 'douban', `site=${locked.site}`)
assert(locked.seeds.some((u) => /movie\.douban\.com\/top250/i.test(u)), 'official top250 seed')
const lockedPayload = JSON.parse(locked.json)
assert(lockedPayload.preferred_channel === 'http', 'douban prefers http not mcp')
assert(!String(locked.json).includes('csdn'), 'no csdn in site lock')

const structural = inferStructuralTaskPlan(doubanTask)
const taskPlan = mergeStructuralIntoTaskPlan(buildHeuristicStructuredTaskPlan(doubanTask), structural)
const seedFirst = buildSeedFirstPlan(locked.seeds, { maxItems: 10 }, taskPlan)
assert(seedFirst.target === 'douban_top250', `builtin target=${seedFirst.target}`)
assert(seedFirst.seedUrls.every((u) => /movie\.douban\.com\/top250/i.test(u)), 'pagination seeds')
assert(!String(seedFirst.target).includes('manager_seeds'), 'must not be manager_seeds')

const junkHits = [
  { title: 'python爬取豆瓣', url: 'https://blog.csdn.net/weixin_41710905/article/details/80515046', snippet: '教程' },
  { title: '脚本之家', url: 'https://www.jb51.net/article/1.htm', snippet: '教程' },
  { title: '360搜索', url: 'https://m.so.com/s?q=豆瓣', snippet: '搜索' },
  { title: '豆瓣 Top250', url: 'https://movie.douban.com/chart', snippet: '榜单' },
]
const ranked = rankExtractorSerpHitsForTask(doubanTask, junkHits, 4)
assert(ranked.length >= 1, 'keep douban hit')
assert(ranked.every((h) => !isLowValueTutorialSeedUrl(h.url)), 'no tutorial seeds')
assert(ranked.every((h) => isValidCrawlSeedUrl(h.url)), 'valid seeds only')
assert(ranked[0].url.includes('douban.com'), 'douban ranked first')

console.log('smoke-extractor-site-lock-seeds ok')
