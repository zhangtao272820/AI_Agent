/**
 * 历史记忆回填 CLI
 * npx tsx scripts/backfill-memory-from-pg.ts [--dry-run]
 */

import { runMemoryBackfillJob } from '../shared/memoryBackfillJob'

const dryRun = process.argv.includes('--dry-run')

runMemoryBackfillJob(process.env, { dryRun })
  .then((r) => {
    console.log('backfill-memory-from-pg:', JSON.stringify(r, null, 2))
    if (dryRun) console.log('(dry-run: no writes)')
  })
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
