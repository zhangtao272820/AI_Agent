/**
 * Lobster MCP captcha 检测 smoke
 */
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const { detectLobsterSemanticBlock } = await import(
  pathToFileURL(path.join(repoRoot, 'shared/lobsterRunVerifyLite.ts')).href
)

const cases = [
  {
    out: 'Page URL: https://wappass.baidu.com/static/captcha/tuxing_v2.html\nTitle: 百度安全验证',
    url: 'https://wappass.baidu.com/static/captcha/tuxing_v2.html',
    expect: 'captcha',
  },
  {
    out: '请先登录后继续浏览',
    url: 'https://example.com/login',
    expect: 'need_login',
  },
]

for (const c of cases) {
  const block = detectLobsterSemanticBlock({ text: c.out, result: { finalUrl: c.url } })
  assert.equal(block?.failureType, c.expect, `expected ${c.expect} for ${c.url}`)
}

console.log('smoke: lobster mcp captcha detect ok')
