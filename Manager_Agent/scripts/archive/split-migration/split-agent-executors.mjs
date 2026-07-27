/**
 * B5: Split managerGraph.agentExecutors.ts into executors/ submodules.
 */
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const srcPath = path.join(root, 'server/graph/core/managerGraph.agentExecutors.ts')
const outDir = path.join(root, 'server/graph/core/executors')

const lines = fs.readFileSync(srcPath, 'utf8').split(/\r?\n/)
const importBlock = lines.slice(0, 103).join('\n')

function chunk(name, start, end, extra = '') {
  const body = lines.slice(start - 1, end).join('\n')
  return `${importBlock}\n${extra}\n${body}\n`
}

fs.mkdirSync(outDir, { recursive: true })

const chunks = [
  ['types.ts', 105, 174],
  ['sharedHelpers.ts', 176, 264],
  ['dbExecutor.ts', 265, 472],
  ['ragExecutor.ts', 473, 882],
  ['crawlerExecutor.ts', 883, 1162],
  ['guiExecutor.ts', 1163, 1289],
  ['codeExecutor.ts', 1290, 1397],
  ['adminExecutor.ts', 1398, 1521],
  ['stepOutcome.ts', 1522, 1570],
  ['mediaExecutors.ts', 1571, 1698],
  ['internalExecutor.ts', 1699, 1965],
  ['dispatchExecutor.ts', 1968, 2107],
  ['bundle.ts', 2110, lines.length]
]

for (const [file, start, end] of chunks) {
  fs.writeFileSync(path.join(outDir, file), chunk(file, start, end))
}

// VoteScore lives inside stepOutcome slice — also export from types for dispatch
const voteLines = lines.slice(1561, 1569).join('\n')
const typesContent = fs.readFileSync(path.join(outDir, 'types.ts'), 'utf8')
fs.writeFileSync(path.join(outDir, 'types.ts'), `${typesContent}\n${voteLines}\n`)

const indexTs = chunks
  .map(([file]) => `export * from './${file.replace(/\.ts$/, '')}'`)
  .join('\n')
fs.writeFileSync(path.join(outDir, 'index.ts'), `${indexTs}\n`)

const shim = `/** B5: agent executors split — re-export shim */\nexport * from './executors'\n`
fs.writeFileSync(srcPath, shim)

console.log(`split-agent-executors: ${chunks.length} modules in server/graph/core/executors/`)
