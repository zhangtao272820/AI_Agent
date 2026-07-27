/**
 * P2 Skills 按需注入回归
 */
import { getAgentScopedPlaybookAddons } from '../../../server/graph/core/evolution/playbookPrompts'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

const dbOnly = getAgentScopedPlaybookAddons({ allowedAgents: ['db', 'rag'], intent: 'multi' })
assert(!dbOnly.includes('个人助理能力'), 'db/rag should not inject admin addon')
assert(!dbOnly.includes('GUI 浏览器自动化'), 'db/rag should not inject gui addon')

const withAdmin = getAgentScopedPlaybookAddons({ allowedAgents: ['db', 'admin'], intent: 'multi' })
assert(withAdmin.includes('个人助理能力'), 'admin allowed should inject admin addon')

const withGui = getAgentScopedPlaybookAddons({ allowedAgents: ['gui'], intent: 'gui' })
assert(withGui.includes('GUI 浏览器自动化'), 'gui allowed should inject gui addon')

const legacy = getAgentScopedPlaybookAddons({})
assert(legacy.includes('个人助理能力') && legacy.includes('GUI 浏览器自动化'), 'empty filter keeps legacy full inject')

const intentAdmin = getAgentScopedPlaybookAddons({ intent: 'admin' })
assert(intentAdmin.includes('个人助理能力'), 'intent=admin injects admin')
assert(!intentAdmin.includes('GUI 浏览器自动化'), 'intent=admin skips gui')

console.log('smoke-skills-scoped: ok')
