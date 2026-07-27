/**
 * 校验 eval/golden-smoke.json 结构，作为 CI 门禁第一步（不发起真实 LLM 调用）。
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const p = path.join(root, 'eval', 'golden-smoke.json')

const raw = await fs.readFile(p, 'utf8').catch(() => '')
if (!raw.trim()) {
  console.error('missing file:', p)
  process.exit(1)
}
let obj
try {
  obj = JSON.parse(raw)
} catch (e) {
  console.error('invalid JSON:', e?.message || e)
  process.exit(1)
}
if (!obj || typeof obj !== 'object') {
  console.error('root must be object')
  process.exit(1)
}
if (!Array.isArray(obj.cases) || obj.cases.length < 1) {
  console.error('cases must be non-empty array')
  process.exit(1)
}
for (const c of obj.cases) {
  if (!c || typeof c !== 'object') {
    console.error('case must be object')
    process.exit(1)
  }
  if (!String(c.id || '').trim()) {
    console.error('case.id required')
    process.exit(1)
  }
  if (!String(c.user || '').trim()) {
    console.error('case.user required:', c.id)
    process.exit(1)
  }
  if (!c.expect || typeof c.expect !== 'object') {
    console.error('case.expect required:', c.id)
    process.exit(1)
  }
}
console.log('golden-smoke OK:', obj.cases.length, 'cases')
