/**
 * 全量记忆迁移：文件 → clawhive PostgreSQL
 * 用法：AGENT_DATABASE_URL=postgresql://postgres:postgres@localhost:15432/clawhive node scripts/migrate-memory-jsonl-to-pg.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

async function loadPg() {
  const candidates = [
    path.join(repoRoot, 'Manager_Agent', 'node_modules', 'pg'),
    path.join(repoRoot, 'DB_Agent', 'node_modules', 'pg'),
    path.join(repoRoot, 'RAG_Agent', 'node_modules', 'pg'),
    'pg'
  ]
  for (const loc of candidates) {
    try {
      if (loc === 'pg') return (await import('pg')).default
      const pkg = path.join(loc, 'package.json')
      if (fs.existsSync(pkg)) return (await import(pathToFileURL(path.join(loc, 'lib', 'index.js')).href)).default
    } catch { /* try next */ }
  }
  throw new Error('pg package not found; run npm install in Manager_Agent')
}

import { pathToFileURL } from 'node:url'

async function main() {
  const url = String(process.env.AGENT_DATABASE_URL || '').trim()
  if (!url) {
    console.error('AGENT_DATABASE_URL required')
    process.exit(1)
  }
  const Pg = await loadPg()
  const pool = new Pg.Pool({
    connectionString: url.replace(/^postgresql\+psycopg2:/, 'postgresql:'),
    max: 4
  })

  const schemaPath = path.join(repoRoot, 'scripts', 'migrations', '001_agent_memory_schema.sql')
  const schemaSql = fs.readFileSync(schemaPath, 'utf8')
    .replace(/\\echo[^\n]*\n/g, '')
  await pool.query(schemaSql)
  console.log('schema: applied')

  // Manager sessions
  const sessDir = path.join(repoRoot, 'Manager_Agent', '.data', 'sessions')
  if (fs.existsSync(sessDir)) {
    const files = fs.readdirSync(sessDir).filter((f) => f.endsWith('.json'))
    let turns = 0
    for (const f of files) {
      const sid = f.replace(/\.json$/, '')
      const obj = JSON.parse(fs.readFileSync(path.join(sessDir, f), 'utf8'))
      const messages = Array.isArray(obj?.messages) ? obj.messages : []
      if (!messages.length) continue
      await pool.query(
        `INSERT INTO mgr_sessions (id, updated_at) VALUES ($1, NOW()) ON CONFLICT (id) DO UPDATE SET updated_at = NOW()`,
        [sid]
      )
      await pool.query(`DELETE FROM mgr_session_turns WHERE session_id = $1`, [sid])
      let idx = 0
      for (const m of messages) {
        const role = m?.role === 'assistant' ? 'assistant' : 'user'
        const content = String(m?.content ?? '').trim()
        if (!content) continue
        await pool.query(
          `INSERT INTO mgr_session_turns (session_id, turn_index, role, content) VALUES ($1,$2,$3,$4)`,
          [sid, idx++, role, content]
        )
        turns++
      }
    }
    console.log(`mgr_session_turns: ${turns} rows (${files.length} sessions)`)
  }

  // Manager memory jsonl
  const mgrMem = path.join(repoRoot, 'Manager_Agent', '.data', 'manager-memory.jsonl')
  if (fs.existsSync(mgrMem)) {
    let n = 0
    for (const line of fs.readFileSync(mgrMem, 'utf8').split(/\r?\n/).filter(Boolean)) {
      try {
        const row = JSON.parse(line)
        const entryType = String(row.type || 'experience').slice(0, 32)
        const { ts, type, ...payload } = row
        await pool.query(
          `INSERT INTO mgr_memory_entries (ts, entry_type, payload) VALUES ($1,$2,$3)`,
          [ts || new Date().toISOString(), entryType, JSON.stringify(payload)]
        )
        n++
      } catch { /* skip */ }
    }
    console.log(`mgr_memory_entries: ${n} rows`)
  }

  async function migrateJsonl(agentDir, fileName, inserter) {
    const p = path.join(repoRoot, agentDir, '.data', fileName)
    if (!fs.existsSync(p)) return
    let n = 0
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean)) {
      try {
        const row = JSON.parse(line)
        await inserter(row)
        n++
      } catch { /* skip */ }
    }
    console.log(`${fileName}: ${n} rows`)
  }

  await migrateJsonl('DB_Agent', 'db-learning-signals.jsonl', async (r) => {
    await pool.query(
      `INSERT INTO db_learning_signals (ts, question, question_norm, path, ok, empty, data_domain, intent, tables, ms, reason, feedback)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [r.ts, r.question, r.question_norm, r.path ?? null, r.ok, r.empty ?? null,
        r.data_domain ?? null, r.intent ?? null, r.tables ? JSON.stringify(r.tables) : null,
        r.ms ?? null, r.reason ?? null, r.feedback ?? null]
    )
  })

  await migrateJsonl('DB_Agent', 'db-query-experience.jsonl', async (r) => {
    await pool.query(
      `INSERT INTO db_query_experience (ts, question_norm, path, data_domain, tables, hint)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [r.ts, r.question_norm, r.path ?? null, r.data_domain ?? null,
        r.tables ? JSON.stringify(r.tables) : null, r.hint]
    )
  })

  const dbRoute = path.join(repoRoot, 'DB_Agent', '.data', 'db-route-preferences.json')
  if (fs.existsSync(dbRoute)) {
    try {
      const raw = JSON.parse(fs.readFileSync(dbRoute, 'utf8'))
      const rows = Array.isArray(raw?.rows) ? raw.rows : []
      let n = 0
      for (const r of rows) {
        await pool.query(
          `INSERT INTO db_route_stats (context_key, path, trials, successes, empty_count, avg_ms, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,NOW())
           ON CONFLICT (context_key, path) DO UPDATE SET
             trials=EXCLUDED.trials, successes=EXCLUDED.successes,
             empty_count=EXCLUDED.empty_count, avg_ms=EXCLUDED.avg_ms, updated_at=NOW()`,
          [r.contextKey, r.path, r.trials ?? 0, r.successes ?? 0, r.empty ?? 0, r.avgMs ?? 0]
        )
        n++
      }
      console.log(`db_route_stats: ${n} rows`)
    } catch { /* skip */ }
  }

  await migrateJsonl('RAG_Agent', 'rag-learning-signals.jsonl', async (r) => {
    await pool.query(
      `INSERT INTO rag_learning_signals (at, question, question_norm, score, comment, path, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [r.at, r.question, r.question_norm ?? null, r.score, r.comment ?? null, r.path ?? null, r.source ?? null]
    )
  })

  const ragRoute = path.join(repoRoot, 'RAG_Agent', '.data', 'rag-route-preferences.json')
  if (fs.existsSync(ragRoute)) {
    try {
      const payload = JSON.parse(fs.readFileSync(ragRoute, 'utf8'))
      await pool.query(
        `INSERT INTO rag_route_preferences (id, updated_at, payload) VALUES (1, NOW(), $1)
         ON CONFLICT (id) DO UPDATE SET updated_at=NOW(), payload=EXCLUDED.payload`,
        [JSON.stringify(payload)]
      )
      console.log('rag_route_preferences: 1 row')
    } catch { /* skip */ }
  }

  const ragSess = path.join(repoRoot, 'RAG_Agent', '.data', 'rag-session-memory.json')
  if (fs.existsSync(ragSess)) {
    try {
      const store = JSON.parse(fs.readFileSync(ragSess, 'utf8'))
      let n = 0
      for (const [sid, mem] of Object.entries(store)) {
        if (!mem || typeof mem !== 'object') continue
        const m = mem
        await pool.query(
          `INSERT INTO rag_session_memory (session_id, summary, topics, updated_at)
           VALUES ($1,$2,$3,to_timestamp($4/1000.0))
           ON CONFLICT (session_id) DO UPDATE SET summary=EXCLUDED.summary, topics=EXCLUDED.topics, updated_at=EXCLUDED.updated_at`,
          [sid, String(m.summary ?? ''), JSON.stringify(m.topics ?? []), Number(m.updatedAt ?? Date.now())]
        )
        n++
      }
      console.log(`rag_session_memory: ${n} rows`)
    } catch { /* skip */ }
  }

  await pool.end()
  console.log('migrate-memory-jsonl-to-pg: done')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
