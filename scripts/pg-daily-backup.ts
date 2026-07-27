/**
 * PG 日备 CLI：npx tsx scripts/pg-daily-backup.ts
 */

import { runPgDailyBackup } from '../shared/pgDailyBackupJob'

runPgDailyBackup()
  .then((r) => {
    if (!r.ok) {
      console.error(r.error || 'backup failed')
      process.exit(1)
    }
    console.log(`backup ok: ${r.file} (${r.sizeKb} KB)`)
  })
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
