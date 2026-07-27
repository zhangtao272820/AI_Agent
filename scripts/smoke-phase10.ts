/**
 * Phase 10 smoke：记忆回填 job
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { inferToolSuccessFromExperience, isMemoryBackfillEnabled } from '../shared/memoryBackfillJob'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`[smoke-phase10] ${msg}`)
}

console.log('smoke-phase10: start')
assert(isMemoryBackfillEnabled(), 'backfill enabled by default')

const li = inferToolSuccessFromExperience(
  {
    user: '在数据库中查询李雨桐的人力驾驶舱的项目记录',
    path: ['db'],
    successScore: 0.85,
    failureCategory: 'route_error',
    probeDbMatched: true
  },
  'db'
)
assert(li, 'backfill infers db success for 李雨桐 case')

assert(fs.existsSync(path.join(repoRoot, 'shared/memoryBackfillJob.ts')), 'memoryBackfillJob exists')
assert(fs.existsSync(path.join(repoRoot, 'scripts/backfill-memory-from-pg.ts')), 'backfill CLI exists')

const opsSrc = fs.readFileSync(path.join(repoRoot, 'Manager_Agent/server/api/manager/ops.post.ts'), 'utf8')
assert(opsSrc.includes('memory_backfill'), 'ops has memory_backfill action')

console.log('smoke-phase10: OK')
