/**
 * Repair B5 batch split corruption: clean types.ts, move helpers to create*.ts
 */
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()

function extractExportTypes(content) {
  const blocks = []
  let rest = content
  while (true) {
    const start = rest.indexOf('export type ')
    if (start < 0) break
    let depth = 0
    let end = start
    for (let i = start; i < rest.length; i++) {
      if (rest[i] === '{') depth++
      else if (rest[i] === '}') {
        depth--
        if (depth === 0) {
          end = i + 1
          break
        }
      }
    }
    blocks.push(rest.slice(start, end).trim())
    rest = rest.slice(end)
  }
  return { types: blocks.join('\n\n'), rest: rest.trim() }
}

function fixCreateImport(createPath, depsType) {
  let c = fs.readFileSync(createPath, 'utf8')
  c = c.replace(/\nimport type \{ Create[^}]+\} from '\.\/types'\n/g, '\n')
  const fnIdx = c.indexOf('export function create')
  if (fnIdx < 0) return
  if (!c.slice(0, fnIdx).includes(`from './types'`)) {
    c = c.slice(0, fnIdx) + `import type { ${depsType} } from './types'\n\n` + c.slice(fnIdx)
    fs.writeFileSync(createPath, c, 'utf8')
  }
}

function repair(dir, depsType, typeImports = '') {
  const dirPath = path.join(root, dir)
  const typesPath = path.join(dirPath, 'types.ts')
  if (!fs.existsSync(typesPath)) return
  const { types, rest } = extractExportTypes(fs.readFileSync(typesPath, 'utf8'))
  fs.writeFileSync(typesPath, `${typeImports}${typeImports ? '\n\n' : ''}${types}\n`, 'utf8')

  const createFile = fs.readdirSync(dirPath).find((f) => f.startsWith('create') && f.endsWith('.ts'))
  if (!createFile) return
  const createPath = path.join(dirPath, createFile)
  fixCreateImport(createPath, depsType)

  if (rest) {
    let c = fs.readFileSync(createPath, 'utf8')
    const fnIdx = c.indexOf('export function create')
    const head = c.slice(0, fnIdx).trimEnd()
    if (!head.includes(rest.slice(0, 50))) {
      fs.writeFileSync(createPath, `${head}\n\n${rest}\n\n${c.slice(fnIdx)}`, 'utf8')
    }
  }
  console.log('repair:', dir)
}

repair('server/graph/nodes/planLinter', 'CreatePlanLinterNodeDeps', "import type { LlmInvokeFn } from '../../llm/managerGraph.taskConstraintsLlm'")
repair('server/graph/nodes/orchestrate', 'CreateOrchestrateNodeDeps', "import type { LlmInvokeFn } from '../../llm/managerGraph.taskConstraintsLlm'")
repair('server/graph/nodes/toolHealth', 'CreateToolHealthNodeDeps')
repair('server/graph/nodes/search', 'CreateWebSearchNodeDeps', "import { ChatOpenAI } from '@langchain/openai'")
repair('server/graph/nodes/intentClassify', 'CreateIntentClassifyNodeDeps', "import type { LlmInvokeFn } from '../../llm/managerGraph.taskConstraintsLlm'")
repair('server/graph/nodes/probe', 'CreateProbeNodeDeps')

console.log('repair-batch-node-splits: done')
