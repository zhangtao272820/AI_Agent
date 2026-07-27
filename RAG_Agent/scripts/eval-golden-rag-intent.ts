/**
 * 离线 eval：golden-rag-intent-paraphrase — 结构校验 + RG-P1-3 导出存在性
 * 完整 intent paraphrase 需在线 catalog/inferRagIntentLlm eval（playbook 仅 hint）
 * 用法：cd RAG_Agent && npx tsx scripts/eval-golden-rag-intent.ts
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(fileURLToPath(import.meta.url))
const goldenPath = join(root, '../eval/golden-rag-intent-paraphrase.json')
const builderPath = join(root, '../server/utils/query_plan_builder.ts')

type GoldenCase = {
  id: string
  user: string
  expect: { intent: string; includes?: string[] }
}

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

function main() {
  const builderSrc = readFileSync(builderPath, 'utf8')
  assert(builderSrc.includes('export async function inferRagIntentLlm'), 'RG-P1-3 inferRagIntentLlm missing')
  assert(builderSrc.includes('export async function inferRetrievalKeywordsLlm'), 'RG-P1-4 inferRetrievalKeywordsLlm missing')
  const nluSrc = readFileSync(join(root, '../server/utils/rag_nlu.ts'), 'utf8')
  assert(nluSrc.includes('inferRetrievalKeywordsLlm'), 'rag_nlu wires RG-P1-4')
  const raw = JSON.parse(readFileSync(goldenPath, 'utf8')) as { cases: GoldenCase[] }
  assert(raw.cases.length >= 3, 'golden must have >= 3 cases')
  for (const c of raw.cases) {
    assert(c.user.length >= 4, `${c.id}: user too short`)
    assert(Boolean(c.expect.intent), `${c.id}: missing expect.intent`)
    for (const inc of c.expect.includes ?? []) {
      assert(c.user.includes(inc), `${c.id}: user should mention ${inc}`)
    }
  }
  console.log(`eval-golden-rag-intent: OK (${raw.cases.length} cases + RG-P1-3/4 exports)`)
}

main()
