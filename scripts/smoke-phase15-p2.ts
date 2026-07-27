/**
 * Phase 15（P2）smoke：Code/Crawler/GUI 联邦 + 双模型质检 + MCP Registry
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  shouldSyncCodeExperience,
  shouldSyncCrawlerExperience,
  shouldSyncGuiExperience
} from '../shared/agentOutcomePolicy'
import { isCodeExperienceBridgeEnabled } from '../shared/codeExperienceBridge'
import { isCrawlerExperienceBridgeEnabled } from '../shared/crawlerExperienceBridge'
import { isGuiExperienceBridgeEnabled } from '../shared/guiExperienceBridge'
import { formatMcpRegistryBlockForPlanner, isMcpRegistryEnabled, loadMcpToolRegistry } from '../shared/mcpToolRegistry'
import { isDualModelQaEnabled } from '../Manager_Agent/server/utils/managerGraph.modelTier'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`[smoke-phase15-p2] ${msg}`)
}

function readSource(rel: string): string {
  return fs.readFileSync(path.join(repoRoot, rel), 'utf8')
}

console.log('smoke-phase15-p2: start')

const gateOff = { MGR_FEDERATION_REQUIRE_FEEDBACK: '0' } as NodeJS.ProcessEnv

assert(isCodeExperienceBridgeEnabled(), 'code bridge enabled by default')
assert(isCrawlerExperienceBridgeEnabled(), 'crawler bridge enabled by default')
assert(isGuiExperienceBridgeEnabled(), 'gui bridge enabled by default')
assert(isMcpRegistryEnabled(), 'mcp registry enabled by default')
assert(isDualModelQaEnabled(), 'dual model QA enabled by default')

assert(
  shouldSyncCodeExperience(
    {
      successScore: 0.9,
      planAgents: ['code'],
      results: { code: '已成功生成 ECharts 配置并写入 src/chart.ts' }
    },
    gateOff
  ),
  'code experience sync eligible when gate off'
)

assert(
  shouldSyncCrawlerExperience(
    {
      successScore: 0.88,
      planAgents: ['crawler'],
      results: { crawler: '已从 example.com 抓取 12 条商品记录' }
    },
    gateOff
  ),
  'crawler experience sync eligible when gate off'
)

assert(
  shouldSyncGuiExperience(
    {
      successScore: 0.86,
      planAgents: ['gui'],
      results: { gui: '已完成登录并提交表单，截图已保存' }
    },
    gateOff
  ),
  'gui experience sync eligible when gate off'
)

assert(
  !shouldSyncCodeExperience({
    successScore: 0.9,
    planAgents: ['code'],
    results: { code: '已成功生成 ECharts 配置并写入 src/chart.ts' }
  }),
  'code experience deferred when P0 federation gate on'
)

const finalSrc = readSource('Manager_Agent/server/utils/managerGraph.finalNodes.ts')
assert(finalSrc.includes('syncCodeExperienceFromManagerRun'), 'finalNodes syncs code experience')
assert(finalSrc.includes('syncCrawlerExperienceFromManagerRun'), 'finalNodes syncs crawler experience')
assert(finalSrc.includes('syncGuiExperienceFromManagerRun'), 'finalNodes syncs gui experience')
assert(finalSrc.includes("llmInvoke('verifier'"), 'verifier uses dedicated stage')

const orchestratorSrc = readSource('shared/artifactFeedbackOrchestrator.ts')
assert(orchestratorSrc.includes("promoted.push('code')"), 'confirm promotes code federation')
assert(orchestratorSrc.includes("promoted.push('crawler')"), 'confirm promotes crawler federation')

const modelTierSrc = readSource('Manager_Agent/server/utils/managerGraph.modelTier.ts')
assert(modelTierSrc.includes("'verifier'"), 'model tier has verifier stage')
assert(modelTierSrc.includes('MANAGER_DUAL_MODEL_QA'), 'dual model QA env')

const ctxSrc = readSource('Manager_Agent/server/utils/managerGraph.contextComposer.ts')
assert(ctxSrc.includes('loadMcpToolRegistry'), 'planner loads mcp registry')

assert(fs.existsSync(path.join(repoRoot, 'shared/codeExperienceBridge.ts')), 'codeExperienceBridge exists')
assert(fs.existsSync(path.join(repoRoot, 'shared/crawlerExperienceBridge.ts')), 'crawlerExperienceBridge exists')
assert(fs.existsSync(path.join(repoRoot, 'shared/guiExperienceBridge.ts')), 'guiExperienceBridge exists')
assert(fs.existsSync(path.join(repoRoot, 'shared/mcpToolRegistry.ts')), 'mcpToolRegistry exists')
assert(fs.existsSync(path.join(repoRoot, 'scripts/migrations/012_agent_memory_phase15_p2.sql')), 'migration 012 exists')

process.env.MGR_MCP_REGISTRY_JSON = JSON.stringify([
  {
    server: 'demo',
    tools: [{ name: 'demo_tool', description: 'smoke demo', agent: 'admin', risk: 'low' }]
  }
])

async function main() {
  const tools = await loadMcpToolRegistry()
  assert(tools.some((t) => t.toolName === 'demo_tool'), 'env mcp registry parsed')
  const block = formatMcpRegistryBlockForPlanner(tools)
  assert(block.includes('demo/demo_tool'), 'planner block formatted')
  console.log('smoke-phase15-p2: OK')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
