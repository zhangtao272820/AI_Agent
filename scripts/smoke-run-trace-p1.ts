/**
 * P1 smoke：Run Trace PG + HITL 决策审计
 * 用法：cd Manager_Agent && npx tsx ../scripts/smoke-run-trace-p1.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  appendRunTraceEvent,
  listHitlDecisionsForRun,
  listRunTraceEvents,
  recordHitlDecision
} from '../shared/runTraceStore'
import { isAgentPgConfigured } from '../shared/agentPgClient'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`[smoke-run-trace-p1] ${msg}`)
}

function readSource(rel: string): string {
  return fs.readFileSync(path.join(repoRoot, rel), 'utf8')
}

console.log('smoke-run-trace-p1: start')

async function main() {
  const migration = readSource('scripts/migrations/010_agent_memory_phase13_p1.sql')
  assert(migration.includes('mgr_run_trace_events'), 'migration trace events')
  assert(migration.includes('mgr_hitl_decisions'), 'migration hitl decisions')

  const wsSrc = readSource('Manager_Agent/server/api/manager-ws.ts')
  assert(wsSrc.includes('appendRunTraceEvent'), 'manager-ws dual-writes trace PG')
  assert(wsSrc.includes('recordHitlDecision'), 'manager-ws records hitl decisions')

  const obsSrc = readSource('Manager_Agent/server/utils/managerGraph.runObservability.ts')
  assert(obsSrc.includes('traceEvents'), 'run observability includes trace events')
  assert(obsSrc.includes('hitlDecisions'), 'run observability includes hitl decisions')

  if (isAgentPgConfigured()) {
    const runId = `smoke_trace_${Date.now()}`
    const sessionId = `smoke_sess_${Date.now()}`
    const ok1 = await appendRunTraceEvent({
      runId,
      sessionId,
      event: 'thinking',
      fromAgent: 'manager',
      payload: { text: 'smoke trace' }
    })
    assert(ok1, 'append trace event')
    const ok2 = await recordHitlDecision({
      runId,
      sessionId,
      confirmId: 'c1',
      decision: 'confirm',
      payload: { kind: 'smoke' }
    })
    assert(ok2, 'record hitl decision')
    const events = await listRunTraceEvents(runId)
    assert(events.length >= 1, 'list trace events')
    const hitl = await listHitlDecisionsForRun(runId)
    assert(hitl.length >= 1, 'list hitl decisions')
    console.log(`smoke-run-trace-p1: pg roundtrip runId=${runId} events=${events.length} hitl=${hitl.length}`)
  } else {
    console.log('smoke-run-trace-p1: skip PG roundtrip (AGENT_DATABASE_URL not set)')
  }

  console.log('smoke-run-trace-p1: OK')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
