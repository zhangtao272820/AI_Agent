/**
 * Phase II 离线结构回归（PU-Stack / cap floor / admin 闸门 / golden 文件）
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { resolveAdminAutoConfirm } from '../../../server/graph/core/db/writeGate'
import { isPuStackOrchestratorAuthority } from '../../../server/graph/orchestrate/puStackOrchestratorAuthority'
import { isProStrongRouteEnabled, shouldPuStackBypassOrchestratorLlm } from '../../../server/graph/core/routing/proRoutePolicy'
import { applyCapFloor } from '../../../server/graph/orchestrate/orchestratorCapPolicy'
import { buildBlueprintFromPuStackDispatch } from '../../../server/graph/llm/planBlueprintLlm'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '../../..')

process.env.MANAGER_ROUTE_MODE ??= 'convergence'
process.env.MANAGER_PRO_MODE ??= 'strong'
process.env.MANAGER_EVOLUTION_MODE ??= 'convergence'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

// P0 admin：路线查询非写操作 → autoConfirm
const mapQ = '坐地铁从天津西站到天津站大概多久'
assert(resolveAdminAutoConfirm({ meta: {} }, mapQ) === true, 'map query auto confirm')
assert(resolveAdminAutoConfirm({ meta: {} }, '安排明天10点的项目会议') === false, 'write still needs confirm')

const { shouldPassthroughDbOnly } = await import('#agent-shared/deterministicPassthrough')
assert(
  shouldPassthroughDbOnly({ intent: 'db', results: { db: '林婉清足底压力检测共 1 次' }, planSteps: [{ agent: 'db' }] }) === true,
  'chat mode db passthrough'
)
assert(
  shouldPassthroughDbOnly({
    intent: 'db',
    results: { db: '林婉清足底压力检测共 1 次' },
    planSteps: [{ agent: 'db' }],
    professionalMode: true
  }) === false,
  'professional mode disables db passthrough'
)

// P0 cap floor frozen
const floor = ['rag', 'db', 'admin', 'clean', 'code', 'visualize'] as const
const shrunk = applyCapFloor(['db'], [...floor])
for (const a of floor) assert(shrunk.includes(a), `cap floor restores ${a}`)

assert(isProStrongRouteEnabled(), 'strong route default on')
assert(
  isPuStackOrchestratorAuthority({
    stepDispatchDraft: [
      { agent: 'rag', scopedUserLanguage: '查配比标准', clauseIds: ['c1'] },
      { agent: 'db', scopedUserLanguage: '查检测记录', clauseIds: ['c2'] }
    ]
  }),
  'pu stack composite hint from draft'
)
assert(!shouldPuStackBypassOrchestratorLlm({
  stepDispatchDraft: [
    { agent: 'rag', scopedUserLanguage: 'a', clauseIds: ['c1'] },
    { agent: 'db', scopedUserLanguage: 'b', clauseIds: ['c2'] }
  ]
}), 'strong route: no bypass orchestrator LLM')

// E1 blueprint topology
const e1Draft = [
  { agent: 'rag', scopedUserLanguage: '查失能老人护理员配比标准', clauseIds: ['c1'] },
  { agent: 'db', scopedUserLanguage: '查张三血压和血糖记录', clauseIds: ['c2'] }
]
const e1Bp = buildBlueprintFromPuStackDispatch({
  allowedAgents: ['rag', 'db', 'clean', 'code', 'visualize'],
  stepDispatchDraft: e1Draft,
  userTask: '知识库查失能老人护理员配比，数据库查张三血压血糖，对比分析并出图'
})
assert(e1Bp && e1Bp.steps.map((s) => s.agent).join(',') === 'rag,db,clean,code,visualize', 'E1 blueprint order')

const goldenFiles = [
  'eval/golden-step-query-scope.json',
  'eval/golden-pro-understand.json',
  'eval/golden-real-domain-route.json'
]
for (const rel of goldenFiles) {
  const raw = await fs.readFile(path.join(root, rel), 'utf8')
  const j = JSON.parse(raw)
  assert(Array.isArray(j.cases) && j.cases.length > 0, `${rel} has cases`)
}

const childScripts = [
  '../plan/smoke-step-query-scope.ts',
  '../misc/smoke-mode-isolation.ts',
  '../plan/smoke-clarify-replan.ts',
  '../route/smoke-real-domain-route.ts'
]
for (const script of childScripts) {
  const r = spawnSync('npx', ['--yes', 'tsx', path.join(__dirname, script)], {
    cwd: root,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, MANAGER_SMOKE_SKIP_LLM: '1' }
  })
  assert(r.status === 0, `${script} failed`)
}

console.log('smoke: phase2 upgrades ok')
