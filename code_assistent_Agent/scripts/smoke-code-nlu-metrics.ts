/**
 * C1-5：NLU metrics smoke（离线）
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

const dir = mkdtempSync(join(tmpdir(), 'code-nlu-smoke-'))
const prev = process.cwd()
process.chdir(dir)
process.env.CODE_ENABLE_METRICS = '1'

const { recordCodeNluMetric, readRecentCodeNluMetrics } = await import('../server/utils/code_nlu_metrics')

recordCodeNluMetric({
  ok: true,
  task_kind: 'edit',
  source: 'llm',
  confidence: 0.91,
  hint_files: ['server/utils/foo.ts'],
  write_allowed: true,
  question: '改 foo.ts',
})

const rows = readRecentCodeNluMetrics(5)
assert(rows.length === 1, 'one nlu metric row')
assert(rows[0]?.task_kind === 'edit', 'task_kind persisted')
assert(rows[0]?.source === 'llm', 'source persisted')

process.chdir(prev)
rmSync(dir, { recursive: true, force: true })

console.log('smoke-code-nlu-metrics: PASS')
