#!/usr/bin/env node
/**
 * 清空各 Agent 经验向量（JSON/JSONL + clawhive PG），不影响 RAG 文档向量库 rag_pgvector。
 * 用法：node scripts/clear-experience-vectors.mjs [--yes]
 */
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const args = new Set(process.argv.slice(2))
if (!args.has('--yes')) {
  console.error('将清空：db_experience_vectors、mgr_memory_embeddings（clawhive PG）')
  console.error('以及各 Agent .data 下的 *experience*vector* / manager-memory-embeddings.jsonl')
  console.error('RAG 文档向量库（rag_pgvector）不受影响。确认请加 --yes')
  process.exit(1)
}

const pgUrl = process.env.AGENT_DATABASE_URL || 'postgresql://postgres:postgres@localhost:15432/clawhive'

const TRUNCATE_SQL = `
TRUNCATE TABLE db_experience_vectors, mgr_memory_embeddings RESTART IDENTITY;
`

function runPsql(sql) {
  const useDocker = pgUrl.includes('localhost:15432') || pgUrl.includes('clawhive_postgres')
  if (useDocker) {
    execSync('docker exec -i clawhive_postgres psql -U postgres -d clawhive -v ON_ERROR_STOP=1', {
      input: sql,
      stdio: ['pipe', 'inherit', 'inherit']
    })
  } else {
    execSync(`psql "${pgUrl}" -v ON_ERROR_STOP=1`, { input: sql, stdio: ['pipe', 'inherit', 'inherit'] })
  }
}

const LOCAL_VECTOR_FILES = [
  'Manager_Agent/.data/manager-memory-embeddings.jsonl',
  'DB_Agent/.data/db-experience-vectors.json',
  'RAG_Agent/.data/rag-experience-vectors.json',
  'code_assistent_Agent/.data/code-experience-vectors.json',
  'Extractor_Agent/.data/extractor-experience-vectors.json'
]

const DOCKER_CLEAR = [
  ['manager_agent', "echo -n '' > /app/.data/manager-memory-embeddings.jsonl"],
  ['db_agent', "echo '[]' > /app/.data/db-experience-vectors.json"],
  ['rag_agent', "echo '[]' > /app/.data/rag-experience-vectors.json"],
  ['code_assistent_agent', "echo '[]' > /app/.data/code-experience-vectors.json"],
  ['extractor_agent', "echo '[]' > /app/.data/extractor-experience-vectors.json"]
]

console.log('clear-experience-vectors: truncating PG tables...')
try {
  runPsql(TRUNCATE_SQL)
  console.log('  PG truncate ok')
} catch (e) {
  console.warn('  PG truncate skipped:', e?.message || e)
}

for (const rel of LOCAL_VECTOR_FILES) {
  const file = path.join(process.cwd(), rel)
  if (!fs.existsSync(file)) continue
  const empty = rel.endsWith('.jsonl') ? '' : '[]'
  fs.writeFileSync(file, empty, 'utf8')
  console.log(`  cleared local ${rel}`)
}

for (const [container, cmd] of DOCKER_CLEAR) {
  try {
    execSync(`docker exec ${container} sh -c ${JSON.stringify(cmd)}`, { stdio: 'inherit' })
    console.log(`  cleared ${container}`)
  } catch {
    console.warn(`  skip ${container} (not running?)`)
  }
}

console.log('clear-experience-vectors: done')
