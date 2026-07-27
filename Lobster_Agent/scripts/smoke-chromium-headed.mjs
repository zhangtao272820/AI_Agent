import { chromium } from 'playwright'
import fs from 'node:fs'

const home = '/app/.data/pw-home'
fs.mkdirSync(`${home}/.config`, { recursive: true })
fs.mkdirSync(`${home}/.cache`, { recursive: true })

const browser = await chromium.launch({
  headless: false,
  ignoreDefaultArgs: ['--enable-automation'],
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-crash-reporter'],
  env: { ...process.env, DISPLAY: ':99', HOME: home, XDG_CONFIG_HOME: `${home}/.config`, XDG_CACHE_HOME: `${home}/.cache` }
})
const page = await browser.newPage()
await page.goto('https://example.com', { timeout: 15000 })
console.log('HEADED_OK', await page.title())
await browser.close()
