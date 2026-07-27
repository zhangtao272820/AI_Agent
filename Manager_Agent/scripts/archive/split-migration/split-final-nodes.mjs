/**
 * B5: Split managerGraph.finalNodes.ts — helpers + per-node builders.
 */
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const srcPath = path.join(root, 'server/graph/nodes/managerGraph.finalNodes.ts')
const outDir = path.join(root, 'server/graph/nodes/final')

const lines = fs.readFileSync(srcPath, 'utf8').split(/\r?\n/)
const importBlock = lines.slice(0, 93).join('\n')

function write(name, start, end, wrapper = null) {
  const body = lines.slice(start - 1, end).join('\n')
  const content = wrapper ? wrapper(body) : `${importBlock}\n\n${body}\n`
  fs.writeFileSync(path.join(outDir, name), content)
}

fs.mkdirSync(outDir, { recursive: true })

write('schemas.ts', 95, 105)
write('helpers.ts', 107, 163)
write('types.ts', 165, 198)

const nodeWrapper = (nodeName) => (body) => `${importBlock}
import type { CreateFinalNodesDeps } from './types'
import { CriticVerdictSchema, type CriticVerdict } from './schemas'
import { mergeSynthFinalWithReportBody, appendDeferredReportBlockIfNeeded } from './helpers'

export function build${nodeName.charAt(0).toUpperCase() + nodeName.slice(1)}(deps: CreateFinalNodesDeps) {
${body.split('\n').map((l) => (l ? `  ${l}` : l)).join('\n')}
}
`

write('synthNode.ts', 231, 690, nodeWrapper('synthNode'))
write('criticNode.ts', 691, 973, nodeWrapper('criticNode'))
write('verifierNode.ts', 974, 1082, nodeWrapper('verifierNode'))
write('finalizeNode.ts', 1083, 1673, nodeWrapper('finalizeNode'))

const factoryTs = `${importBlock}
import type { CreateFinalNodesDeps } from './types'
import { buildSynthNode } from './synthNode'
import { buildCriticNode } from './criticNode'
import { buildVerifierNode } from './verifierNode'
import { buildFinalizeNode } from './finalizeNode'

export type { CreateFinalNodesDeps } from './types'

export function createFinalNodes(deps: CreateFinalNodesDeps) {
  return {
    synthNode: buildSynthNode(deps),
    criticNode: buildCriticNode(deps),
    verifierNode: buildVerifierNode(deps),
    finalizeNode: buildFinalizeNode(deps)
  }
}
`
fs.writeFileSync(path.join(outDir, 'createFinalNodes.ts'), factoryTs)

const shim = `/** B5: final nodes split — re-export shim */\nexport { createFinalNodes, type CreateFinalNodesDeps } from './final/createFinalNodes'\n`
fs.writeFileSync(srcPath, shim)

console.log('split-final-nodes: server/graph/nodes/final/ created')
