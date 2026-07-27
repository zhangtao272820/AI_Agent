/**
 * Phase 7 smoke：PG 召回统一、Tool Memory、Memory Fold、Skill Auto Draft
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isMemoryFoldEnabled } from '../shared/memoryFoldJob'
import { isToolMemoryEnabled } from '../shared/toolMemoryStore'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`[smoke-phase7] ${msg}`)
}

function readSource(rel: string): string {
  return fs.readFileSync(path.join(repoRoot, rel), 'utf8')
}

console.log('smoke-phase7: start')

assert(isMemoryFoldEnabled(), 'memory fold enabled by default')
assert(isToolMemoryEnabled(), 'tool memory enabled by default')

const skillAutoSrc = readSource('Manager_Agent/server/utils/skillDraftAuto.ts')
assert(skillAutoSrc.includes('MGR_SKILL_AUTO_DRAFT'), 'skill auto draft module present')
assert(skillAutoSrc.includes('verifyManagerEvolutionPromote'), 'skill auto draft uses verify gate')

const longMemSrc = readSource('Manager_Agent/server/utils/managerGraph.longMemory.ts')
assert(longMemSrc.includes('readManagerExperienceHistory'), 'longMemory must use PG-first history')

const vecSrc = readSource('Manager_Agent/server/utils/managerGraph.vectorMemory.ts')
assert(vecSrc.includes('searchMgrEmbeddingsByVector'), 'vectorMemory must support PG pgvector recall')

const layeredSrc = readSource('Manager_Agent/server/utils/managerGraph.layeredMemory.ts')
assert(layeredSrc.includes('readLayeredMemoryRows'), 'layeredMemory must read semantic/reflection from PG')

assert(fs.existsSync(path.join(repoRoot, 'scripts/migrations/005_agent_memory_phase7.sql')), 'phase7 migration exists')
assert(fs.existsSync(path.join(repoRoot, 'scripts/migrate-jsonl-to-pg.ts')), 'jsonl migration script exists')
assert(fs.existsSync(path.join(repoRoot, 'shared/managerMemoryHistory.ts')), 'managerMemoryHistory module exists')

console.log('smoke-phase7: OK')
