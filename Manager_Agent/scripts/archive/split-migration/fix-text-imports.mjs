import fs from 'node:fs'
import path from 'node:path'

const dir = path.join(process.cwd(), 'server/graph/core/text')
const fixes = [
  ["from '../llmJson'", "from '../managerGraph.llmJson'"],
  ["from '../managerGraph.dbStepQuestion'", "from '../managerGraph.dbStepQuestion'"],
  ["from '../managerGraph.nlResolve'", "from '../managerGraph.nlResolve'"]
]

for (const name of fs.readdirSync(dir)) {
  if (!name.endsWith('.ts') || name === 'index.ts') continue
  const p = path.join(dir, name)
  let c = fs.readFileSync(p, 'utf8')
  c = c.replace(/from '\.\/managerGraph\./g, "from '../managerGraph.")
  if (name === 'routingContext.ts') {
    c = c.replace("import { isExplicitMultiRequest } from './routeAdvisory'\n\n", '')
    if (!c.includes('export function isExplicitMultiRequest')) {
      c = c.replace(
        'export function shouldPreferMulti',
        `/** 结构性 multi 信号：多行独立需求（不含关键词表） */
export function isExplicitMultiRequest(text: string) {
  return hasStructuralMultiLineBullets(String(text || ''))
}

export function shouldPreferMulti`
      )
    }
  }
  fs.writeFileSync(p, c, 'utf8')
}

console.log('fix-text-imports: done')
