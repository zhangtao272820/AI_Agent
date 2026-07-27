/**
 * jsonl → PG 迁移：Manager 经验/分层记忆一次性导入
 * 用法：npx tsx scripts/migrate-jsonl-to-pg.ts [--dry-run]
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { agentPgQuery, isAgentPgConfigured, pingAgentPg } from '../shared/agentPgClient'
import { recordMemory } from '../shared/agentMemoryApi'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

function parseArgs() {
  const dryRun = process.argv.includes('--dry-run')
  const policyDir = process.env.MANAGER_DATA_DIR
    ? path.resolve(process.env.MANAGER_DATA_DIR)
    : path.join(repoRoot, 'Manager_Agent', '.data')
  return { dryRun, policyDir }
}

async function readJsonl(filePath: string): Promise<Array<Record<string, unknown>>> {
  const raw = await fs.readFile(filePath, 'utf8').catch(() => '')
  if (!raw.trim()) return []
  const out: Array<Record<string, unknown>> = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      out.push(JSON.parse(line) as Record<string, unknown>)
    } catch {
      /* skip */
    }
  }
  return out
}

async function countPgByType(): Promise<Record<string, number>> {
  const res = await agentPgQuery<{ entry_type: string; n: string }>(
    `SELECT entry_type, COUNT(*)::text AS n FROM mgr_memory_entries GROUP BY entry_type`
  )
  const out: Record<string, number> = {}
  for (const row of res?.rows ?? []) {
    out[row.entry_type] = Number(row.n) || 0
  }
  return out
}

async function main() {
  const { dryRun, policyDir } = parseArgs()
  console.log(`migrate-jsonl-to-pg: policyDir=${policyDir} dryRun=${dryRun}`)

  if (!isAgentPgConfigured()) {
    console.error('AGENT_DATABASE_URL not configured')
    process.exit(1)
  }
  const ok = await pingAgentPg()
  if (!ok) {
    console.error('PG not reachable')
    process.exit(1)
  }

  const before = await countPgByType()
  console.log('PG before:', before)

  const files: Array<{ file: string; type: 'experience' | 'semantic' | 'reflection' }> = [
    { file: 'manager-memory.jsonl', type: 'experience' },
    { file: 'manager-memory-semantic.jsonl', type: 'semantic' },
    { file: 'manager-memory-reflections.jsonl', type: 'reflection' }
  ]

  let imported = 0
  let skipped = 0

  for (const { file, type } of files) {
    const fp = path.join(policyDir, file)
    const rows = await readJsonl(fp)
    console.log(`${file}: ${rows.length} lines`)
    for (const row of rows) {
      const entryType = String(row.type || type)
      if (entryType === 'clarify' || entryType === 'critic_clarify') {
        skipped += 1
        continue
      }
      const payload = { ...row }
      delete payload.type
      const successScore = Number(payload.successScore ?? payload.success_score ?? 0.72)
      if (entryType === 'experience' && successScore < 0.72) {
        skipped += 1
        continue
      }
      if (dryRun) {
        imported += 1
        continue
      }
      const r = await recordMemory(
        {
          type: entryType as 'experience' | 'semantic' | 'reflection',
          agent: 'manager',
          successScore,
          payload
        },
        process.env
      )
      if (r.ok) imported += 1
      else skipped += 1
    }
  }

  const after = dryRun ? before : await countPgByType()
  console.log(`done: imported=${imported} skipped=${skipped}`)
  console.log('PG after:', after)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
