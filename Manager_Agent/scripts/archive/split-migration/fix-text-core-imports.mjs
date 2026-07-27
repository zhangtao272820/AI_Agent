import fs from 'node:fs'
import path from 'node:path'

const dir = path.join(process.cwd(), 'server/graph/core/text')
const llmMods = ['managerGraph.mediaRouteLlm', 'managerGraph.taskConstraintsLlm', 'managerGraph.intentClassifyLlm']

for (const name of fs.readdirSync(dir)) {
  if (!name.endsWith('.ts') || name === 'index.ts') continue
  const p = path.join(dir, name)
  let c = fs.readFileSync(p, 'utf8')
  for (const mod of llmMods) {
    c = c.replaceAll(`from '../llm/${mod}'`, `from '../../llm/${mod}'`)
    c = c.replaceAll(`from './${mod}'`, `from '../../llm/${mod}'`)
  }
  c = c.replace(/from '\.\/managerGraph\.([^']+)'/g, "from '../managerGraph.$1'")
  fs.writeFileSync(p, c, 'utf8')
}
console.log('fix-text-core-imports: ok')
