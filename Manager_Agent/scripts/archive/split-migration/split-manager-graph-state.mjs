/**
 * B5: Split managerGraph.ts → state/{graphAnnotation,graphFactoryHelpers,createManagerGraph}.ts
 */
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const srcPath = path.join(root, 'server/graph/state/managerGraph.ts')
const lines = fs.readFileSync(srcPath, 'utf8').split(/\r?\n/)
const importBlock = lines.slice(0, 74).join('\n')

const graphAnnotation = `import { Annotation } from '@langchain/langgraph'
import { BaseMessage } from '@langchain/core/messages'
import { z } from 'zod'
import {
  ForceIntentSchema,
  IntentSchema,
  normalizeEntities,
  type ForceIntent,
  type Intent,
  type Step,
  type TaskPlan
} from '../../utils/taskPlan'

${lines.slice(76, 448).join('\n')}

export { FixStrategySchema, GraphState }
export type FixStrategy = z.infer<typeof FixStrategySchema>
`

const graphFactoryHelpers = `import type { Intent } from '../../utils/taskPlan'
import type { TaskConstraints } from '../core/managerGraph.plan'
import { buildClarifyQuestionsFromContext } from '../core/managerGraph.clarifyContext'

export type SendEvent = (event: { event: string; data?: any; from?: string }) => void

${lines.slice(449, 488).join('\n')}

export { readEnvNumber, readEnvString, buildClarifyQuestions }
export type { ExperienceIndex }
`

const createManagerGraph = `${importBlock}
import { GraphState, FixStrategySchema } from './graphAnnotation'
import {
  buildClarifyQuestions,
  readEnvNumber,
  readEnvString,
  type ExperienceIndex,
  type SendEvent
} from './graphFactoryHelpers'

${lines.slice(489).join('\n')}
`

fs.writeFileSync(path.join(root, 'server/graph/state/graphAnnotation.ts'), graphAnnotation)
fs.writeFileSync(path.join(root, 'server/graph/state/graphFactoryHelpers.ts'), graphFactoryHelpers)
fs.writeFileSync(path.join(root, 'server/graph/state/createManagerGraph.ts'), createManagerGraph)
fs.writeFileSync(
  srcPath,
  `/** B5: manager graph factory split — re-export shim */\nexport { createManagerGraph } from './createManagerGraph'\n`
)

console.log('split-manager-graph-state: graphAnnotation + graphFactoryHelpers + createManagerGraph created')
