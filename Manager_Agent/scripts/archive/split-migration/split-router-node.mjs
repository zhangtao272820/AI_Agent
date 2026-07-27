/**
 * B5: Split managerGraph.routerNode.ts → server/graph/nodes/router/
 */
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const srcPath = path.join(root, 'server/graph/nodes/managerGraph.routerNode.ts')
const outDir = path.join(root, 'server/graph/nodes/router')
const lines = fs.readFileSync(srcPath, 'utf8').split(/\r?\n/)
const importBlock = lines.slice(0, 88).join('\n')

fs.mkdirSync(outDir, { recursive: true })

const helpers = `import {
  finalizeLlmAllowedAgents,
  type ExecutableAgent
} from '../../core/managerGraph.routeFinalize'

/** skill.md 不可读时的极简兜底（正常部署不会走到） */
export const ROUTER_PLAYBOOK_FALLBACK =
  '你是意图理解/路由 Agent（Intents Router）。理解用户意图并输出严格 JSON 路由结果（intent、allowedAgents、needsClarify 等）。'

export function deriveAllowedAgentsFromRoute(intent: string, llmAllowed: ExecutableAgent[]): ExecutableAgent[] {
  return finalizeLlmAllowedAgents(intent, llmAllowed, null)
}

export function finalizeAllowedAgents(intent: string, llmAllowed: ExecutableAgent[], forced: string | null): ExecutableAgent[] {
  return finalizeLlmAllowedAgents(intent, llmAllowed, forced)
}
`

const types = `import type { TaskConstraints } from '../../core/managerGraph.plan'
import type { ExecutableAgent } from '../../core/managerGraph.routeFinalize'

export type CreateRouterNodeDeps = {
  policyDir: string
  sessionId?: string
  runId?: string
  userId?: string
  opts: { sendEvent: (event: { event: string; data?: any; from?: string }) => void }
  policyPromise: Promise<any>
  defaultPolicy: () => any
  lastUserText: (messages: any[]) => string
  isExplicitMultiRequest: (text: string) => boolean
  shouldPreferMulti: (text: string, probe?: any) => boolean
  needsDataFoundation: (text: string) => boolean
  RouteSchema: any
  llmInvoke: (stage: 'route' | 'plan' | 'synth' | 'critic', state: any, messages: any[]) => Promise<{ text: string; resources: any; meta: any }>
  mergeMeta: (state: any, patch: Record<string, any>) => Record<string, any>
  safeJsonParse: (text: string) => any
  summarize: (text: string, max?: number) => string
  appendConstraintsToQuery: (query: string, constraints: TaskConstraints) => string
  uncertaintyFromConfidence: (confidence: number) => 'low' | 'medium' | 'high'
  normalizeEntities: (v: any) => any
}
`

const createBody = lines.slice(123).join('\n')
const createRouterNode = `${importBlock}
import { ROUTER_PLAYBOOK_FALLBACK, deriveAllowedAgentsFromRoute, finalizeAllowedAgents } from './helpers'
import type { CreateRouterNodeDeps } from './types'

${createBody}
`

fs.writeFileSync(path.join(outDir, 'helpers.ts'), helpers)
fs.writeFileSync(path.join(outDir, 'types.ts'), types)
fs.writeFileSync(path.join(outDir, 'createRouterNode.ts'), createRouterNode)
fs.writeFileSync(
  path.join(outDir, 'index.ts'),
  `export { createRouterNode, type CreateRouterNodeDeps } from './createRouterNode'\nexport { ROUTER_PLAYBOOK_FALLBACK, deriveAllowedAgentsFromRoute, finalizeAllowedAgents } from './helpers'\n`
)

fs.writeFileSync(
  srcPath,
  `/** B5: router node split — re-export shim */\nexport { createRouterNode, type CreateRouterNodeDeps } from './router'\n`
)

console.log('split-router-node: server/graph/nodes/router/ created')
