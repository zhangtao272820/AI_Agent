/**
 * B5: Split managerGraph.plan.ts → server/graph/core/plan/
 */
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const srcPath = path.join(root, 'server/graph/core/managerGraph.plan.ts')
const outDir = path.join(root, 'server/graph/core/plan')
const lines = fs.readFileSync(srcPath, 'utf8').split(/\r?\n/)

const importBlock = lines.slice(0, 28).join('\n')

const constantsBody = lines.slice(29, 127).join('\n')
const topologyBody = lines.slice(128, 519).join('\n')
const coverageBody = lines.slice(520, 635).join('\n')
const buildBody = lines.slice(636).join('\n')

fs.mkdirSync(outDir, { recursive: true })

const constants = `${importBlock}

${constantsBody}

export {
  ROUTE_CAP_MANDATORY_AGENTS,
  COVERAGE_AGENT_ORDER,
  PIPELINE_DOWNSTREAM_AGENTS,
  DATA_SOURCE_AGENTS_LOCAL,
  DATA_SOURCE_AGENTS,
  isPostCodeCleanStep
}
`

const topology = `${importBlock}
import {
  ROUTE_CAP_MANDATORY_AGENTS,
  COVERAGE_AGENT_ORDER,
  PIPELINE_DOWNSTREAM_AGENTS,
  DATA_SOURCE_AGENTS_LOCAL,
  DATA_SOURCE_AGENTS,
  isPostCodeCleanStep,
  ALL_PLAN_AGENTS,
  coverageFallbackQuery,
  type TaskConstraints
} from './constants'

${topologyBody}
`

const coverage = `${importBlock}
import {
  COVERAGE_AGENT_ORDER,
  DATA_SOURCE_AGENTS,
  ALL_PLAN_AGENTS,
  coverageFallbackQuery,
  isMediaOnlyCap,
  type TaskConstraints
} from './constants'
import { toAgentCapSet, sortPlanByPipelineOrder } from './topology'

${coverageBody}
`

const build = `${importBlock}
import { type TaskConstraints } from './constants'

${buildBody}
`

fs.writeFileSync(path.join(outDir, 'constants.ts'), constants)
fs.writeFileSync(path.join(outDir, 'topology.ts'), topology)
fs.writeFileSync(path.join(outDir, 'coverage.ts'), coverage)
fs.writeFileSync(path.join(outDir, 'build.ts'), build)
fs.writeFileSync(
  path.join(outDir, 'index.ts'),
  `export * from './constants'
export * from './topology'
export * from './coverage'
export * from './build'
`
)

fs.writeFileSync(
  srcPath,
  `/** B5: plan core split — re-export shim */\nexport * from './plan'\n`
)

console.log('split-plan-core: server/graph/core/plan/ created')
