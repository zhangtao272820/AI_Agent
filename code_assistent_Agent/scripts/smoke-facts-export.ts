/**
 * P1 exports · facts CSV smoke（离线）
 */
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { exportFactsToCsv, shouldAutoExportFacts, factsToCsv } from '../server/utils/factsExport'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

const csv = factsToCsv([
  { key: 'total', value: 42, source: 'db', agent: 'db' },
  { key: 'region', value: '华东', source: 'db', agent: 'db' },
])
assert(csv.includes('total,42'), 'csv content')

assert(
  shouldAutoExportFacts({
    taskKind: 'script',
    facts: [{ key: 'a', value: 1 }],
    enabled: true,
  }),
  'script auto export',
)

const dir = mkdtempSync(join(tmpdir(), 'code-export-smoke-'))
const prev = process.cwd()
process.chdir(dir)
const out = exportFactsToCsv({
  facts: [{ key: 'x', value: 'y', agent: 'rag' }],
  name: 'test_facts',
})
assert(out.ok && out.path, 'export ok')
assert(existsSync(join(dir, '.data', 'exports', out.path!.replace('.data/exports/', ''))), 'file exists')
const text = readFileSync(join(dir, '.data', 'exports', out.path!.replace('.data/exports/', '')), 'utf8')
assert(text.includes('x,y'), 'file content')

process.chdir(prev)
rmSync(dir, { recursive: true, force: true })

console.log('smoke-facts-export: PASS')
