/**
 * SERP hybrid：验证码/拦截页有任意可用摘要即 fail-fast，不必 URL 精确匹配。
 */
import {
  hasAnySerpExcerpt,
  shouldFailFastToSerp,
  type SerpHit
} from '../server/utils/serp_hybrid'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

const hits: SerpHit[] = [
  {
    title: '足底压力参考',
    url: 'https://example.com/guide-a',
    snippet: '正常成人足弓指数参考约 0.21-0.26，可用于对照实测值'
  }
]

assert(hasAnySerpExcerpt(hits), 'hasAnySerpExcerpt')

const opts = { __serpHybrid: true }
const blockedUrl = 'https://other.example.com/page-with-captcha'

assert(
  shouldFailFastToSerp(blockedUrl, hits, opts, 'captcha_or_block_page') === true,
  'captcha + any SERP excerpt → fail-fast even if URL not in hits'
)
assert(
  shouldFailFastToSerp(blockedUrl, hits, opts, '云抓取返回拦截页/验证码') === true,
  'Chinese captcha message fail-fast'
)
assert(
  shouldFailFastToSerp(blockedUrl, hits, opts) === false,
  'without errMsg still requires URL-matched excerpt for preemptive maxAttempts'
)
assert(
  shouldFailFastToSerp(blockedUrl, hits, {}, 'captcha_or_block_page') === false,
  'no __serpHybrid → no fail-fast'
)
assert(
  shouldFailFastToSerp(blockedUrl, [], opts, 'captcha_or_block_page') === false,
  'empty serpHits → no fail-fast'
)

console.log('smoke-serp-failfast: OK')
