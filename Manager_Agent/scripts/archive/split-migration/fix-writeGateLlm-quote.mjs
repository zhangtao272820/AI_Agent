import fs from 'node:fs'
import path from 'node:path'

const p = path.join(process.cwd(), 'server/graph/llm/managerGraph.writeGateLlm.ts')
const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/)
lines[5] = "import { looksLikeRiskyAdminWrite } from '../../../shared/textMarkers';"
fs.writeFileSync(p, lines.join('\n'), 'utf8')
console.log('fixed writeGateLlm line 6:', lines[5])
