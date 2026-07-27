const pg = require('pg')
console.log('pg_load_ok', typeof pg.Pool)
const url = process.env.AGENT_DATABASE_URL
if (!url) {
  console.log('no_url')
  process.exit(1)
}
const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 5000 })
pool
  .query('SELECT 1 AS ok')
  .then((r) => {
    console.log('ping_ok', r.rows[0])
    return pool.end()
  })
  .catch((e) => {
    console.log('ping_fail', e.message)
    return pool.end().finally(() => process.exit(1))
  })
