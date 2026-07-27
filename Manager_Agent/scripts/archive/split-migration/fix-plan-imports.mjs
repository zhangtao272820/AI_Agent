/**
 * Fix imports in server/graph/core/plan/* after subdir split.
 */
import fs from 'node:fs'
import path from 'node:path'

const planDir = path.join(process.cwd(), 'server/graph/core/plan')

for (const name of fs.readdirSync(planDir)) {
  if (!name.endsWith('.ts') || name === 'constants.ts') continue
  const p = path.join(planDir, name)
  let content = fs.readFileSync(p, 'utf8')
  content = content
    .replace(/from '\.\/managerGraph\./g, "from '../managerGraph.")
    .replace(/from "\.\/managerGraph\./g, 'from "../managerGraph.')
    .replace(/from '\.\.\/llm\//g, "from '../../llm/")
    .replace(/from '\.\.\/orchestrate\//g, "from '../../orchestrate/")
  if (name === 'topology.ts') {
    content = content.replace(/\nconst DATA_SOURCE_AGENTS = new Set<Step\['agent'\]>\(\['rag', 'db', 'crawler'\]\)\n/, '\n')
  }
  fs.writeFileSync(p, content, 'utf8')
}

console.log('fix-plan-imports: done')
