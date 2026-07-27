/**
 * user profile：通过 CDP 附着用户已登录 Chrome
 */
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { resolveBrowserCdpUrl } from './browserProfiles'

export async function connectBrowserOverCdp(cdpUrl?: string): Promise<Browser> {
  const url = String(cdpUrl || resolveBrowserCdpUrl()).trim()
  if (!url) throw new Error('browser_cdp_url_missing')
  return chromium.connectOverCDP(url)
}

export async function resolveCdpPage(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const contexts = browser.contexts()
  const context = contexts[0] ?? (await browser.newContext())
  const pages = context.pages()
  const page = pages[0] ?? (await context.newPage())
  page.setDefaultTimeout(20_000)
  page.setDefaultNavigationTimeout(45_000)
  return { context, page }
}
