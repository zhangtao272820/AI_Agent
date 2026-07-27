import fs from 'node:fs'
import path from 'node:path'

function pwHomeDir(): string {
  return String(process.env.LOBSTER_PW_HOME || '/app/.data/pw-home').trim() || '/app/.data/pw-home'
}

/** Linux/Docker headed Chromium 需要可写 HOME，否则 crashpad 启动即退出 */
export function ensurePwUserHome(): string {
  const home = pwHomeDir()
  if (process.platform !== 'linux') return home
  try {
    fs.mkdirSync(path.join(home, '.config'), { recursive: true })
    fs.mkdirSync(path.join(home, '.cache'), { recursive: true })
  } catch {}
  return home
}

/** Playwright chromium.launch 参数（Docker headed + headless 通用） */
export function buildChromiumLaunchOptions(headless: boolean): {
  args: string[]
  env: NodeJS.ProcessEnv
} {
  const args = [
    '--disable-blink-features=AutomationControlled',
    '--disable-dev-shm-usage',
    '--no-default-browser-check',
    '--disable-features=IsolateOrigins,site-per-process'
  ]
  const env: NodeJS.ProcessEnv = { ...process.env }

  if (process.platform === 'linux') {
    args.push(
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      '--disable-crash-reporter'
    )
    if (!headless) {
      const home = ensurePwUserHome()
      env.HOME = home
      env.XDG_CONFIG_HOME = path.join(home, '.config')
      env.XDG_CACHE_HOME = path.join(home, '.cache')
    }
  }

  return { args, env }
}
