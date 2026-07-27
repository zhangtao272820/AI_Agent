/**
 * P2-B1：Repo Map smoke
 */
import { buildRepoMap, formatRepoMap } from '../server/services/repoMap'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

const entries = await buildRepoMap({
  maxFiles: 200,
  hintFiles: ['server/services/agent.ts'],
  hintSymbols: ['handleAgentChat'],
  question: 'explain code agent entry',
})

assert(entries.length > 0, 'repo map not empty')
const top = entries[0]!
assert(top.file.includes('agent.ts') || top.score > 0, 'hint file boosts ranking')

const prompt = formatRepoMap(entries, 512)
assert(prompt.includes('Repo Map'), 'prompt header')
assert(prompt.includes('agent.ts') || prompt.includes('code_assistent'), 'relevant file in prompt')

console.log('smoke-repo-map: PASS', { files: entries.length, top: top.file, score: top.score.toFixed(2) })
