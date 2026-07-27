/**
 * Re-split text from git (utf8-safe) into core/text/
 */
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

const root = process.cwd()
const repoRoot = path.resolve(root, '..')
const raw = execSync('git show HEAD:Manager_Agent/server/utils/managerGraph.text.ts', {
  cwd: repoRoot,
  encoding: 'utf8'
})
const lines = raw.split(/\r?\n/)
const outDir = path.join(root, 'server/graph/core/text')

const importBlock = lines.slice(0, 9).join('\n')
  .replace("from './taskPlan'", "from '../../../utils/taskPlan'")
  .replace("from './managerGraph.", "from '../managerGraph.")
  .replace("from '../managerGraph.mediaRouteLlm'", "from '../../llm/managerGraph.mediaRouteLlm'")
  .replace("from '../managerGraph.taskConstraintsLlm'", "from '../../llm/managerGraph.taskConstraintsLlm'")

function slice(start, end) {
  return lines.slice(start - 1, end).join('\n')
}

fs.mkdirSync(outDir, { recursive: true })

fs.writeFileSync(path.join(outDir, 'routingContext.ts'), `${importBlock}

${slice(23, 110)}
/** 结构性 multi 信号：多行独立需求（不含关键词表） */
export function isExplicitMultiRequest(text: string) {
  return hasStructuralMultiLineBullets(String(text || ''))
}
`)

fs.writeFileSync(path.join(outDir, 'clarifyPayloads.ts'), `${importBlock}

${slice(112, 194)}
`)

fs.writeFileSync(path.join(outDir, 'scenarioAndFormat.ts'), `${importBlock}
import { hasStructuralMultiLineBullets } from './routingContext'

${slice(196, 346)}
`)

fs.writeFileSync(path.join(outDir, 'constraintsQuery.ts'), `${importBlock}

${slice(348, 456)}
`)

fs.writeFileSync(path.join(outDir, 'routeAdvisory.ts'), `${importBlock}
import {
  hasStructuralMultiLineBullets,
  isExplicitMultiRequest,
  preferCurrentTurnScope,
  routingConversationContext
} from './routingContext'

${slice(458, 621)}
`)

fs.writeFileSync(
  path.join(outDir, 'misc.ts'),
  `${slice(13, 21)}
${slice(623, 628)}
`
)

fs.writeFileSync(
  path.join(outDir, 'index.ts'),
  `export * from './routingContext'
export * from './clarifyPayloads'
export * from './scenarioAndFormat'
export * from './constraintsQuery'
export * from './routeAdvisory'
export * from './misc'
`
)

console.log('restore-text-split: ok')
