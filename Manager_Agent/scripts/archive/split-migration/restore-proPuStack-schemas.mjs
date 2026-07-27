/**
 * Restore managerGraph.proPuStack.ts from agent transcript Write record.
 * Then rebuild schemas.ts for proPuStack/ split from lines 25-128.
 */
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const transcripts = [
  'C:/Users/Administrator/.cursor/projects/e-Agent/agent-transcripts/d92eb4ac-0dab-412f-bd47-32913a968050/d92eb4ac-0dab-412f-bd47-32913a968050.jsonl',
  'C:/Users/Administrator/.cursor/projects/e-Agent/agent-transcripts/7aae642a-4c72-4b7c-b5fd-05c10d1bf53b/7aae642a-4c72-4b7c-b5fd-05c10d1bf53b.jsonl'
]

let full = null
for (const tp of transcripts) {
  if (!fs.existsSync(tp)) continue
  for (const line of fs.readFileSync(tp, 'utf8').split(/\n/)) {
    if (!line.includes('PreservedConstraintsSchema')) continue
    try {
      const j = JSON.parse(line)
      const w = j.message?.content?.find((x) => x.type === 'tool_use' && x.name === 'Write')
      const c = w?.input?.contents
      const p = w?.input?.path || ''
      if (c?.includes('PreservedConstraintsSchema') && p.includes('proPuStack')) {
        full = c
          .replace(/from '\.\/managerInteractionMode'/g, "from '../../utils/managerInteractionMode'")
          .replace(/from '\.\/managerGraph\.dataPlaneRoutingHint'/g, "from './managerGraph.dataPlaneRoutingHint'")
          .replace(/from '\.\/managerGraph\.taskConstraintsLlm'/g, "from '../../llm/managerGraph.taskConstraintsLlm'")
        break
      }
    } catch {
      /* skip bad lines */
    }
  }
  if (full) break
}

if (!full) {
  console.error('restore-proPuStack: transcript not found')
  process.exit(1)
}

const lines = full.split(/\r?\n/)
const schemaStart = lines.findIndex((l) => l.startsWith('export const PreservedConstraintsSchema'))
const schemaEnd = lines.findIndex((l) => l.startsWith('export function isProUnifiedPuStackEnabled'))
if (schemaStart < 0 || schemaEnd < 0) {
  console.error('restore-proPuStack: schema bounds not found')
  process.exit(1)
}

const schemaBlock = lines.slice(schemaStart, schemaEnd + 3).join('\n')
const schemaFile = `import { z } from 'zod'
import { resolveManagerEnvBool } from '../../../utils/managerEnvModes'

${schemaBlock}

export { TaskShapeSchema, DataPlaneSchema, ActionPlaneSchema, AmbiguitySchema, ProPuStackUnifiedSchema }
`

fs.writeFileSync(path.join(root, 'server/graph/core/proPuStack/schemas.ts'), schemaFile, 'utf8')

// Keep canonical full file for future splits / reference
fs.writeFileSync(path.join(root, 'server/graph/core/managerGraph.proPuStack.full.ts.bak'), full, 'utf8')

console.log('restore-proPuStack: schemas.ts restored', schemaFile.split(/\n/).length, 'lines')
