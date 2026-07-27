import { chromium } from 'playwright'

/** 总管 probe：health=进程存活，ready=Playwright 浏览器可用 */
export default defineEventHandler(async () => {
  let browserReady = false
  let detail = 'playwright_missing'
  try {
    const exe = chromium.executablePath()
    browserReady = Boolean(exe)
    detail = browserReady ? 'playwright_installed' : 'playwright_missing'
  } catch {
    detail = 'playwright_check_failed'
  }
  return {
    ok: true,
    ready: browserReady,
    service: 'extractor_agent',
    browser: browserReady ? 'installed' : 'missing',
    detail,
    ts: new Date().toISOString()
  }
})
