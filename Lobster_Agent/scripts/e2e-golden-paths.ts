/**
 * G4/G5 黄金路径编排：按环境 skip，任一 FAIL 则非零退出
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const tsx = process.platform === 'win32' ? 'npx.cmd' : 'npx'

function runScript(name: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const script = path.join(root, name)
    const child = spawn(tsx, ['tsx', script], {
      stdio: 'inherit',
      env: process.env,
      shell: process.platform === 'win32',
    })
    child.on('error', reject)
    child.on('close', (code) => resolve(code ?? 1))
  })
}

async function main() {
  const results: Array<{ name: string; code: number }> = []
  for (const script of ['e2e-golden-g4-desktop.ts', 'e2e-g5-user-cdp.ts', 'e2e-g3-runoob.ts', 'e2e-g2-baidu-search.ts']) {
    const code = await runScript(script)
    results.push({ name: script, code })
  }
  const failed = results.filter((r) => r.code !== 0)
  if (failed.length) {
    console.error(`[e2e-golden-paths] FAIL: ${failed.map((f) => f.name).join(', ')}`)
    process.exit(1)
  }
  console.log('[e2e-golden-paths] PASS (all scripts exit 0 or skip)')
}

main().catch((e) => {
  console.error(`[e2e-golden-paths] error: ${(e as Error)?.message || e}`)
  process.exit(1)
})
