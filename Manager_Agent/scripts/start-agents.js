import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const base = path.resolve(__dirname, '..', '..')
const apps = [
  { name: 'DB_Agent', cwd: path.join(base, 'DB_Agent'), port: String(process.env.DB_PORT || 13101) },
  { name: 'RAG_Agent', cwd: path.join(base, 'RAG_Agent'), port: String(process.env.RAG_PORT || 13102) },
  { name: 'code_assistent_Agent', cwd: path.join(base, 'code_assistent_Agent'), port: String(process.env.CODE_PORT || 13103) },
  { name: 'Extractor_Agent', cwd: path.join(base, 'Extractor_Agent'), port: String(process.env.CRAWLER_PORT || 13104) },
  {
    name: 'AI_admin_Agent',
    cwd: path.join(base, 'AI_admin_Agent', 'backend'),
    port: String(process.env.AI_ADMIN_PORT || 13105),
    run: 'python'
  }
]

const procs = []

function start(app) {
  const isPython = app.run === 'python'
  const args = isPython ? ['-m', 'app.main'] : ['run', 'dev', '--', '--port', app.port]
  const cmd = isPython ? 'python' : 'npm'
  const env = isPython ? { ...process.env, PORT: app.port } : process.env
  const p = spawn(cmd, args, {
    cwd: app.cwd,
    env,
    stdio: 'inherit',
    shell: true,
    windowsHide: true
  })
  procs.push(p)
  p.on('exit', (code) => {
    console.log(`${app.name} exited with code ${code ?? 0}`)
  })
}

for (const app of apps) start(app)

function shutdown() {
  for (const p of procs) {
    try {
      p.kill('SIGINT')
    } catch {}
  }
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
