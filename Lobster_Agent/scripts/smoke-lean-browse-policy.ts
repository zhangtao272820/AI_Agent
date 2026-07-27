/** smoke: OpenClaw 对齐 leanBrowsePolicy */
import {
  classifyLeanBrowseKind,
  extractSearchQueryFromTask,
  isResultListUrl,
  isSearchOpenDestinationUrl,
  leanClassicMaxSteps,
  leanMcpMaxSteps,
  leanStageAfterLanding,
  resolveLeanSearchLandingUrl,
  shouldSpendVisionThisTurn,
} from '../server/services/lobsterAgent/leanBrowsePolicy'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

const q = extractSearchQueryFromTask('打开百度搜索「Python 教程」，提取第一条结果')
assert(q.includes('Python'), `query=${q}`)

const kind = classifyLeanBrowseKind({
  task: '打开百度搜索「Python 教程」，提取第一条结果',
  goals: { mustSearch: true, mustEnterDetail: true, mustExtract: true, searchQuery: q },
})
assert(kind === 'search_open', `kind=${kind}`)

const land = resolveLeanSearchLandingUrl({
  startUrl: 'https://www.baidu.com/',
  searchQuery: q,
  kind,
})
assert(!!land && /wd=/.test(String(land)), `land=${land}`)
assert(isResultListUrl(String(land)))

const stage = leanStageAfterLanding({
  kind,
  landedOnResults: true,
  mustEnterDetail: true,
  mustExtract: true,
})
assert(stage === 'enter_detail', `stage=${stage}`)

assert(leanClassicMaxSteps('search_extract', 20) <= 10)
assert(leanMcpMaxSteps('search_extract', 24) <= 12)

const visionOff = shouldSpendVisionThisTurn({
  kind: 'search_extract',
  useVisionConfig: true,
  stallCount: 0,
  overlayLikely: false,
  captchaLikely: false,
  pageUrl: String(land),
  candidateCount: 12,
  pageTextLen: 2000,
})
assert(visionOff === false, 'result page should skip vision')

const kindByTaskKind = classifyLeanBrowseKind({ task: '随便看看', taskKind: 'search' })
assert(kindByTaskKind === 'search_extract', `taskKind search → ${kindByTaskKind}`)

assert(isSearchOpenDestinationUrl('https://mp.weixin.qq.com/s/abc'), 'weixin is destination')
assert(!isSearchOpenDestinationUrl('https://www.baidu.com/s?wd=python'), 'serp not destination')
assert(!isSearchOpenDestinationUrl('https://wappass.baidu.com/static/captcha/tuxing_v2.html'), 'captcha not destination')

console.log('smoke-lean-browse-policy: PASS')
