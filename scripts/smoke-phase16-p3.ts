/**
 * Phase 16（P3）smoke：在线 Eval + OPA 策略 + KG + 多租户审计
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isOnlineEvalEnabled, isOnlineEvalPromoteGateEnabled, validateCaseStructure } from '../shared/onlineEvalStore'
import { evaluateToolCallPolicy, isToolCallPolicyEnabled, loadPolicyRules } from '../shared/toolCallPolicyEngine'
import { formatKgBlockForPlanner, isKgMemoryEnabled } from '../shared/kgMemoryStore'
import { isTenantScopeEnabled, normalizeTenantId } from '../shared/tenantScope'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`[smoke-phase16-p3] ${msg}`)
}

function readSource(rel: string): string {
  return fs.readFileSync(path.join(repoRoot, rel), 'utf8')
}

async function main() {
  console.log('smoke-phase16-p3: start')

  assert(isOnlineEvalEnabled(), 'online eval enabled by default')
  assert(isOnlineEvalPromoteGateEnabled(), 'eval promote gate enabled by default')
  assert(isToolCallPolicyEnabled(), 'tool call policy enabled by default')
  assert(isKgMemoryEnabled(), 'kg memory enabled by default')
  assert(isTenantScopeEnabled(), 'tenant scope enabled by default')

  assert(normalizeTenantId('acme') === 'acme', 'tenant normalize')
  assert(normalizeTenantId('') === 'default', 'tenant default')

  const caseOk = validateCaseStructure({
    case_id: 'route-db',
    question: '查一下张三用药记录',
    expect_json: { intentHint: 'db' }
  })
  assert(caseOk.ok, 'eval case structure ok')

  const denyGui = await evaluateToolCallPolicy({ agent: 'gui', sessionId: '', risk: 'high', ok: true })
  assert(!denyGui.allow, 'gui without session denied by policy')

  const allowAdmin = await evaluateToolCallPolicy({ agent: 'admin', sessionId: 'sess-1', risk: 'high', ok: true })
  assert(allowAdmin.allow, 'admin with session allowed')

  const rules = await loadPolicyRules()
  assert(rules.some((r) => r.id === 'deny_gui_without_session'), 'default deny gui rule')

  const kgBlock = formatKgBlockForPlanner([
    { id: 1, entityType: 'db_table', entityKey: 'person', label: 'person', sourceAgent: 'db' }
  ])
  assert(kgBlock.includes('person'), 'kg planner block')

  const finalSrc = readSource('Manager_Agent/server/utils/managerGraph.finalNodes.ts')
  assert(finalSrc.includes('upsertKgFromManagerRun'), 'finalize writes kg')

  const execSrc = readSource('Manager_Agent/server/utils/managerGraph.execNodes.ts')
  assert(execSrc.includes('assertToolCallAllowed'), 'exec nodes policy gate')

  const ctxSrc = readSource('Manager_Agent/server/utils/managerGraph.contextComposer.ts')
  assert(ctxSrc.includes('recallKgContextForPlanner'), 'planner kg recall')

  const verifySrc = readSource('shared/evolutionVerify.ts')
  assert(verifySrc.includes('evalGateForPromote'), 'evolution verify eval gate')

  assert(fs.existsSync(path.join(repoRoot, 'scripts/migrations/014_agent_memory_phase16_p3.sql')), 'migration 014')
  assert(fs.existsSync(path.join(repoRoot, 'shared/onlineEvalStore.ts')), 'onlineEvalStore')
  assert(fs.existsSync(path.join(repoRoot, 'shared/toolCallPolicyEngine.ts')), 'toolCallPolicyEngine')
  assert(fs.existsSync(path.join(repoRoot, 'shared/kgMemoryStore.ts')), 'kgMemoryStore')
  assert(fs.existsSync(path.join(repoRoot, 'shared/tenantAuditStore.ts')), 'tenantAuditStore')

  console.log('smoke-phase16-p3: OK')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
