/**
 * B5 batch: split managerGraph.*Node.ts → server/graph/nodes/{name}/
 * Usage: node scripts/split-batch-nodes.mjs
 */
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()

/** @type {Array<{ src: string; dir: string; exportName: string; depsType: string }>} */
const NODES = [
  {
    src: 'server/graph/nodes/managerGraph.planLinterNode.ts',
    dir: 'server/graph/nodes/planLinter',
    exportName: 'createPlanLinterNode',
    depsType: 'CreatePlanLinterNodeDeps'
  },
  {
    src: 'server/graph/nodes/managerGraph.fixNode.ts',
    dir: 'server/graph/nodes/fix',
    exportName: 'createFixNode',
    depsType: 'CreateFixNodeDeps'
  },
  {
    src: 'server/graph/nodes/managerGraph.orchestrateNode.ts',
    dir: 'server/graph/nodes/orchestrate',
    exportName: 'createOrchestrateNode',
    depsType: 'CreateOrchestrateNodeDeps'
  },
  {
    src: 'server/graph/nodes/managerGraph.searchNode.ts',
    dir: 'server/graph/nodes/search',
    exportName: 'createWebSearchNode',
    depsType: 'CreateWebSearchNodeDeps'
  },
  {
    src: 'server/graph/nodes/managerGraph.intentClassifyNode.ts',
    dir: 'server/graph/nodes/intentClassify',
    exportName: 'createIntentClassifyNode',
    depsType: 'CreateIntentClassifyNodeDeps'
  },
  {
    src: 'server/graph/nodes/managerGraph.prefetchNode.ts',
    dir: 'server/graph/nodes/prefetch',
    exportName: 'createPrefetchNode',
    depsType: 'CreatePrefetchNodeDeps'
  },
  {
    src: 'server/graph/nodes/managerGraph.probeNode.ts',
    dir: 'server/graph/nodes/probe',
    exportName: 'createProbeNode',
    depsType: 'CreateProbeNodeDeps'
  },
  {
    src: 'server/graph/nodes/managerGraph.toolHealthNode.ts',
    dir: 'server/graph/nodes/toolHealth',
    exportName: 'createToolHealthNode',
    depsType: 'CreateToolHealthNodeDeps'
  },
  {
    src: 'server/graph/nodes/managerGraph.decomposeNode.ts',
    dir: 'server/graph/nodes/decompose',
    exportName: 'createDecomposeNode',
    depsType: 'CreateDecomposeNodeDeps'
  }
]

function splitNode({ src, dir, exportName, depsType }) {
  const srcPath = path.join(root, src)
  if (fs.readFileSync(srcPath, 'utf8').includes('re-export shim')) {
    console.log(`split-batch-nodes: skip (shim) ${src}`)
    return
  }
  const lines = fs.readFileSync(srcPath, 'utf8').split(/\r?\n/)

  const depsLine = lines.findIndex((l) => new RegExp(`^(export )?type ${depsType}\\b`).test(l))
  const fnLine = lines.findIndex((l) => l.startsWith(`export function ${exportName}`))
  if (depsLine < 0 || fnLine < 0) {
    throw new Error(`${src}: could not locate ${depsType} or ${exportName}`)
  }

  // Walk back through contiguous `type Name = { ... }` blocks (e.g. FixStrategy)
  let typeStart = depsLine
  while (typeStart > 0) {
    let prevIdx = typeStart - 1
    while (prevIdx >= 0 && lines[prevIdx].trim() === '') prevIdx--
    if (prevIdx < 0) break
    const prev = lines[prevIdx].trimEnd()
    if (prev === '}') {
      let j = prevIdx - 1
      while (j >= 0 && !/^type \w+/.test(lines[j].trimEnd())) j--
      if (j >= 0 && /^type \w+/.test(lines[j].trimEnd())) {
        typeStart = j
        continue
      }
    }
    break
  }

  const importBlock = lines.slice(0, typeStart).join('\n')
  const typesBlockRaw = lines.slice(typeStart, fnLine).join('\n')
  const typesBlock = typesBlockRaw.replace(/^type (\w+)/gm, 'export type $1')
  const extraTypes = [...typesBlockRaw.matchAll(/^type (\w+)/gm)].map((m) => m[1]).filter((n) => n !== depsType)
  const typeImport = extraTypes.length
    ? `import type { ${depsType}, ${extraTypes.join(', ')} } from './types'`
    : `import type { ${depsType} } from './types'`
  const createBlock = lines.slice(fnLine).join('\n')

  const outDir = path.join(root, dir)
  fs.mkdirSync(outDir, { recursive: true })

  // types.ts: export type blocks only (no imports from source — add manually if needed)
  const types = `${typesBlock}\n`

  const createFile = `${importBlock}
${typeImport}

${createBlock}
`

  const subdirName = path.basename(dir)
  const createFileName = `${exportName}.ts`

  fs.writeFileSync(path.join(outDir, 'types.ts'), types)
  fs.writeFileSync(path.join(outDir, createFileName), createFile)
  fs.writeFileSync(
    path.join(outDir, 'index.ts'),
    `export { ${exportName}, type ${depsType} } from './${createFileName.replace(/\.ts$/, '')}'\n`
  )

  fs.writeFileSync(
    srcPath,
    `/** B5: ${subdirName} node split — re-export shim */\nexport { ${exportName}, type ${depsType} } from './${subdirName}'\n`
  )

  console.log(`split-batch-nodes: ${src} → ${dir}/`)
}

for (const node of NODES) {
  splitNode(node)
}

console.log('split-batch-nodes: done', NODES.length, 'nodes')
