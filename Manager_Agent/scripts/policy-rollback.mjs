/**
 * 将 `.data/manager-policy.previous.json` 写回 `manager-policy.json`（需先有一次策略自动更新产生备份）。
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const dir = path.join(root, '.data')
const prevPath = path.join(dir, 'manager-policy.previous.json')
const curPath = path.join(dir, 'manager-policy.json')

const prev = await fs.readFile(prevPath, 'utf8').catch(() => '')
if (!prev.trim()) {
  console.error('No manager-policy.previous.json — nothing to rollback.')
  process.exit(1)
}
try {
  JSON.parse(prev)
} catch {
  console.error('Previous policy file is not valid JSON.')
  process.exit(1)
}
await fs.mkdir(dir, { recursive: true }).catch(() => undefined)
await fs.writeFile(curPath, prev, 'utf8')
console.log('Policy rolled back from manager-policy.previous.json -> manager-policy.json')
