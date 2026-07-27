/**
 * PG 部署验收：eval 种子/运行 + memory 统计
 * 用法：cd Manager_Agent && npx tsx ../scripts/smoke-deploy-pg.ts
 */
import { queryMemoryPgStats } from '../shared/memoryDashboard'
import { seedManagerEvalSuiteFromGolden, runEvalSuite, getLatestEvalRun } from '../shared/onlineEvalStore'
import { queryTenantAuditStats } from '../shared/tenantAuditStore'
import { loadPolicyRules } from '../shared/toolCallPolicyEngine'

async function main() {
  console.log('smoke-deploy-pg: start')

  const stats = await queryMemoryPgStats()
  if (!stats.pgReachable) {
    console.error('PG not reachable — set AGENT_DATABASE_URL')
    process.exit(1)
  }
  console.log('memory stats:', {
    sessions: stats.sessions,
    toolMemory: stats.toolMemoryRows,
    dbExp: stats.dbExperienceRows,
    ragSig: stats.ragLearningSignals,
    adminExp: stats.adminToolExperience,
    codeExp: stats.codeExperienceRows,
    mcpReg: stats.mcpRegistryRows
  })

  const seeded = await seedManagerEvalSuiteFromGolden()
  console.log('eval seed:', seeded)

  const run = await runEvalSuite('manager_golden_smoke', { trigger: 'deploy_acceptance' })
  console.log('eval run:', run ? { ok: run.ok, passed: run.passed, failed: run.failed } : null)

  const latest = await getLatestEvalRun('manager_golden_smoke')
  console.log('eval latest:', latest)

  const tenant = await queryTenantAuditStats('default')
  console.log('tenant audit (default):', tenant)

  const rules = await loadPolicyRules()
  console.log('policy rules:', rules.length)

  if (!run?.ok) process.exit(1)
  console.log('smoke-deploy-pg: OK')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
