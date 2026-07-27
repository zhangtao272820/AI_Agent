/**
 * M5 paraphrase golden 门禁：结构校验 + 换说法同 expect 等价组（L3，不进 prompt）。
 * 用法：node scripts/check-eval-paraphrase-all.mjs
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

function expectKey(obj) {
  return JSON.stringify(obj ?? {}, Object.keys(obj ?? {}).sort())
}

async function loadJson(rel) {
  const p = path.join(root, rel)
  const raw = await fs.readFile(p, 'utf8')
  return JSON.parse(raw)
}

function validateParaphraseGroup(cases, getKey, file) {
  const groups = new Map()
  for (const c of cases) {
    const key = getKey(c)
    assert(key, `${file}:${c.id} paraphrase group key empty`)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(c.id)
  }
  const multi = [...groups.values()].filter((ids) => ids.length >= 2)
  assert(multi.length >= 1, `${file}: need >=1 paraphrase group with same expect key (found ${groups.size} groups)`)
  return { groups: groups.size, paraphraseGroups: multi.length, cases: cases.length }
}

async function main() {
  const db = await loadJson('DB_Agent/eval/golden-person-basic-stats.json')
  assert(Array.isArray(db.cases) && db.cases.length >= 2, 'DB paraphrase cases')
  const dbStats = validateParaphraseGroup(
    db.cases,
    (c) => expectKey(c.expect),
    'golden-person-basic-stats.json',
  )

  const rag = await loadJson('RAG_Agent/eval/golden-rag-intent-paraphrase.json')
  assert(Array.isArray(rag.cases) && rag.cases.length >= 3, 'RAG paraphrase cases')
  const ragStats = validateParaphraseGroup(
    rag.cases,
    (c) => String(c.expect?.intent ?? ''),
    'golden-rag-intent-paraphrase.json',
  )

  const admin = await loadJson('Manager_Agent/eval/golden-admin-paraphrase.json')
  assert(Array.isArray(admin.cases) && admin.cases.length >= 2, 'Admin paraphrase cases')
  const adminStats = validateParaphraseGroup(
    admin.cases,
    (c) => String(c.expectAdminScope?.intent ?? ''),
    'golden-admin-paraphrase.json',
  )

  for (const [cmd, args, cwd] of [
    ['npx', ['tsx', 'scripts/eval-golden-person-basic-stats.ts'], path.join(root, 'DB_Agent')],
    ['npx', ['tsx', 'scripts/eval-golden-rag-intent.ts'], path.join(root, 'RAG_Agent')],
    ['npx', ['tsx', 'scripts/eval-golden-admin-paraphrase.ts'], path.join(root, 'Manager_Agent')],
  ]) {
    const r = spawnSync(cmd, args, { cwd, stdio: 'pipe', shell: process.platform === 'win32' })
    const out = `${r.stdout || ''}${r.stderr || ''}`.trim()
    assert(r.status === 0, `${args[1]} failed: ${out || r.status}`)
    console.log(out.split('\n').pop())
  }

  console.log(
    'check-eval-paraphrase-all: OK',
    { db: dbStats, rag: ragStats, admin: adminStats },
  )
}

main().catch((e) => {
  console.error('check-eval-paraphrase-all: FAIL', e.message)
  process.exit(1)
})
