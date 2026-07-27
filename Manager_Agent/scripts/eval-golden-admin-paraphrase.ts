/**
 * 离线 eval：golden-admin-paraphrase — Admin 编排 paraphrase 结构 + Slot SSOT 门禁
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const goldenPath = join(root, '../eval/golden-admin-paraphrase.json')
const adminLlmPath = join(root, '../../AI_admin_Agent/backend/app/core/admin_manager_plan_llm.py')

type GoldenCase = {
  id: string
  user: string
  expectAdminScope: { includes?: string[]; intent?: string }
}

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

function main() {
  const adminSrc = readFileSync(adminLlmPath, 'utf8')
  assert(adminSrc.includes('def resolve_admin_intent_hint'), 'resolve_admin_intent_hint SSOT')
  assert(adminSrc.includes('def understanding_from_manager_task'), 'understanding_from_manager_task')
  assert(adminSrc.includes('_manager_orchestrated_needs_slot_llm'), 'slot skip gate')

  const raw = JSON.parse(readFileSync(goldenPath, 'utf8')) as { cases: GoldenCase[] }
  assert(raw.cases.length >= 2, 'admin paraphrase cases')

  const byIntent = new Map<string, string[]>()
  for (const c of raw.cases) {
    assert(c.user.length >= 4, `${c.id}: user too short`)
    const intent = String(c.expectAdminScope?.intent ?? '').trim()
    assert(intent, `${c.id}: expectAdminScope.intent required`)
    for (const inc of c.expectAdminScope.includes ?? []) {
      const inUser = c.user.includes(inc)
      const weatherSynonym = c.expectAdminScope.intent === 'weather' && inc === '天气' && /气温|天气|降水|风力/u.test(c.user)
      assert(inUser || weatherSynonym || inc.length <= 4, `${c.id}: user should mention "${inc}"`)
    }
    if (!byIntent.has(intent)) byIntent.set(intent, [])
    byIntent.get(intent)!.push(c.id)
  }

  const weatherIds = byIntent.get('weather') ?? []
  assert(weatherIds.length >= 2, 'weather paraphrase pair required')

  console.log(`eval-golden-admin-paraphrase: OK (${raw.cases.length} cases)`)
}

main()
