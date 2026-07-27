/**
 * P3-L2：successCriteria / resultPageHints 纯函数 smoke
 */
import {
  SuccessCriteriaSchema,
  mergeSuccessCriteria,
  evaluateSuccessCriteria,
  isOnResultPage,
  resultPageHintsFor,
} from '../server/services/lobsterSuccessCriteria'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

const parsed = SuccessCriteriaSchema.safeParse({
  urlIncludes: ['/s?', 'wd='],
  selectorPresent: '#content_left',
  extractMin: 1,
})
assert(parsed.success, 'successCriteria schema')

const merged = mergeSuccessCriteria(
  { extractMin: 1 },
  resultPageHintsFor('打开百度搜 Python', 'https://www.baidu.com'),
)
assert(merged.urlIncludes?.some((x) => x.includes('wd') || x.includes('/s')), 'merge urlIncludes')
assert(merged.selectorPresent === '#content_left' || merged.selectorPresent?.includes('content_left'), 'merge selector')

assert(isOnResultPage('https://www.baidu.com/s?wd=Python'), 'baidu /s')
assert(!isOnResultPage('https://news.baidu.com/'), 'not news home')

const pass = evaluateSuccessCriteria({
  url: 'https://www.baidu.com/s?wd=Py',
  extractCount: 2,
  criteria: merged,
})
assert(pass.ok, 'criteria pass on results + extract')

const fail = evaluateSuccessCriteria({
  url: 'https://www.baidu.com/',
  extractCount: 0,
  criteria: { urlIncludes: ['wd='], extractMin: 1 },
})
assert(!fail.ok, 'criteria fail on home')

console.log('smoke-success-criteria: PASS')
