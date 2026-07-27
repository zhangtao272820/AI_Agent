/**
 * Phase 8 smoke：Task stack PG、PG 日备、pg 模块解析
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isPgDailyBackupEnabled } from '../shared/pgDailyBackupJob'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`[smoke-phase8] ${msg}`)
}

function readSource(rel: string): string {
  return fs.readFileSync(path.join(repoRoot, rel), 'utf8')
}

console.log('smoke-phase8: start')
assert(isPgDailyBackupEnabled(), 'pg daily backup enabled by default')
assert(fs.existsSync(path.join(repoRoot, 'scripts/migrations/006_agent_memory_phase8.sql')), 'phase8 migration exists')

const pgClient = readSource('shared/agentPgClient.ts')
assert(pgClient.includes('loadPgModule'), 'agentPgClient resolves pg from Manager_Agent')

const taskStack = readSource('Manager_Agent/server/utils/managerGraph.taskStack.ts')
assert(taskStack.includes('readTaskStackHybrid'), 'task stack uses PG hybrid store')

const migrateRunner = readSource('scripts/run-agent-memory-migrations.ts')
assert(migrateRunner.includes('docker psql fallback'), 'migration runner has docker fallback')

console.log('smoke-phase8: OK')
