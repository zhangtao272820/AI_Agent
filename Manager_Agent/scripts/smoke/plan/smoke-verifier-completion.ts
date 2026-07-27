/**
 * A4：Verifier 完成判定与 Observation 同源契约
 */
import {
  assessVerifierCompletion,
  collectStepObservations,
  verifierReportConflictNote
} from '../../../server/graph/core/output/verifierCompletion'
import { buildStructuredRunReport } from '../../../server/graph/core/output/structuredRunReport'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

const plan = [
  { id: 's1', agent: 'db' as const, query: '查人数' },
  { id: 's2', agent: 'report' as const, query: '写汇总' }
]

assert(assessVerifierCompletion({ intent: 'db', plan: [{ id: 'a', agent: 'db' }] }) === null, 'single hop null')

const allFail = assessVerifierCompletion({
  intent: 'multi',
  plan,
  stepRecords: [
    { id: 's1', agent: 'db', status: 'failed', error: 'timeout' },
    { id: 's2', agent: 'report', status: 'error', error: 'no input' }
  ],
  evidence: [{ kind: 'db' }]
})
assert(allFail?.verdict === 'failed_steps', 'all fail → failed_steps')
assert(allFail?.outcome === 'failed', 'all fail → failed outcome')

const partialFail = assessVerifierCompletion({
  intent: 'multi',
  plan,
  stepRecords: [
    { id: 's1', agent: 'db', status: 'ok' },
    { id: 's2', agent: 'report', status: 'failed', error: 'x' }
  ],
  evidence: [{ kind: 'db' }]
})
assert(partialFail?.verdict === 'failed_steps', 'partial fail verdict')
assert(partialFail?.outcome === 'needs_human', 'partial fail needs_human')

const pass = assessVerifierCompletion({
  intent: 'multi',
  plan,
  stepRecords: [
    { id: 's1', agent: 'db', status: 'ok' },
    { id: 's2', agent: 'report', status: 'success' }
  ],
  evidence: [{ kind: 'db' }, { kind: 'report' }],
  evidenceSupportedClaimRate: 0.9
})
assert(pass?.verdict === 'pass', 'pass verdict')
assert(pass?.outcome === 'completed', 'pass completed')

const lowClaim = assessVerifierCompletion({
  intent: 'multi',
  plan,
  stepRecords: [
    { id: 's1', agent: 'db', status: 'ok' },
    { id: 's2', agent: 'report', status: 'ok' }
  ],
  evidence: [{ kind: 'db' }],
  evidenceSupportedClaimRate: 0.2,
  unsupportedClaims: ['数字无依据']
})
assert(lowClaim?.verdict === 'evidence_insufficient', 'low claim rate')
assert(lowClaim?.outcome === 'needs_human', 'low claim needs_human')

const rollback = assessVerifierCompletion({
  intent: 'multi',
  plan,
  stepRecords: [{ id: 's1', agent: 'db', status: 'ok' }],
  meta: { forcePlanRollback: true }
})
assert(rollback?.verdict === 'goal_uncovered', 'rollback uncovered')
assert(rollback?.outcome === 'needs_human', 'rollback needs_human')

const obs = collectStepObservations({
  plan,
  meta: {
    lastStepRecords: [
      { id: 's1', agent: 'db', status: 'ok' },
      { id: 's2', agent: 'report', status: 'failed', error: 'e' }
    ]
  }
})
assert(obs.length === 2 && obs[1]?.status === 'failed', 'collect from meta')

const report = buildStructuredRunReport({
  goal: '测',
  intent: 'multi',
  plan,
  stepRecords: [
    { id: 's1', agent: 'db', status: 'ok' },
    { id: 's2', agent: 'report', status: 'failed', error: 'boom' }
  ],
  evidence: [{ kind: 'db', query: 'x' }],
  verifierVerdict: partialFail
})
assert(report?.outcome === 'needs_human', 'report uses verdict outcome')
assert(report?.verifierVerdict === 'failed_steps', 'report carries verdict code')
assert(report!.failures.length >= 1, 'failures listed')

const conflict = verifierReportConflictNote('completed', [{ status: 'failed' }])
assert(conflict && conflict.includes('冲突'), 'conflict note when completed+fail')

const adminClarifyPlan = [
  { id: 's1', agent: 'db' as const, query: '查数' },
  { id: 's4', agent: 'admin' as const, query: '建会议' }
]
const adminClarify = assessVerifierCompletion({
  intent: 'multi',
  plan: adminClarifyPlan,
  stepRecords: [
    { id: 's1', agent: 'db', status: 'ok' },
    { id: 's4', agent: 'admin', status: 'error', error: 'needs_clarify', needsClarify: true }
  ],
  evidence: [{ kind: 'db' }]
})
assert(adminClarify?.verdict === 'goal_uncovered', 'admin needs_clarify → goal_uncovered')
assert(adminClarify?.outcome === 'needs_human', 'admin clarify still needs_human for HITL')
assert(String(adminClarify?.note || '').includes('补充信息'), 'admin clarify note')

const adminHard = assessVerifierCompletion({
  intent: 'multi',
  plan: adminClarifyPlan,
  stepRecords: [
    { id: 's1', agent: 'db', status: 'ok' },
    { id: 's4', agent: 'admin', status: 'error', error: 'admin_write_failed' }
  ],
  evidence: [{ kind: 'db' }]
})
assert(adminHard?.verdict === 'failed_steps', 'admin hard fail → failed_steps')
assert(String(adminHard?.note || '').includes('数据步骤已完成'), 'admin hard fail partial success note')

console.log('smoke-verifier-completion: ok')
