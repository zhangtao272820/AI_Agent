import { getRoot, safeResolve } from '../services/fileSystem'
import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs/promises'
import vm from 'node:vm'
import { handleAgentChat } from '../services/agent'
import { getCodeAgentEnv } from '../utils/code_agent_env'
import { runSandboxNpmScript } from '../utils/sandbox_runner'

async function ensureRunScriptAllowed() {
  const runtimeConfig = useRuntimeConfig() as any
  if (runtimeConfig?.chatOnlyMode === true) {
    return { ok: false as const, error: 'chat-only mode: command disabled' }
  }
  const toolsCfg = (runtimeConfig.tools ?? {}) as any
  if (toolsCfg?.commandEnabled !== true) {
    return { ok: false as const, error: 'command tool is disabled' }
  }
  return { ok: true as const }
}

async function getAllowedScripts(rootOverride?: string) {
  const pkgPath = safeResolve('package.json', rootOverride)
  const pkgText = await fs.readFile(pkgPath, 'utf8').catch(() => '')
  if (!pkgText.trim()) return []
  try {
    const pkg = JSON.parse(pkgText) as any
    const scripts = pkg?.scripts && typeof pkg.scripts === 'object' ? Object.keys(pkg.scripts) : []
    return scripts.filter((s) => typeof s === 'string' && s.trim().length > 0)
  } catch {
    return []
  }
}

function sanitize(text: string) {
  return String(text || '')
    .replace(/sk-[A-Za-z0-9]{12,}/g, 'sk-***')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer ***')
}

// Map to store running child processes for each peer
const activeProcesses = new Map<string, ChildProcess>()

export default defineWebSocketHandler({
  open(peer) {
    console.log('WebSocket client connected:', peer.id)
  },

  async message(peer, message) {
    const safeSend = (data: any) => {
      try {
        peer.send(JSON.stringify(data))
      } catch {
        // ignore: connection may be closed mid-send
      }
    }
    try {
      const data = JSON.parse(message.text())
      const send = (type: string, payload: any) => safeSend({ type, payload })

      if (data.type === 'run-script') {
        const { script, args, root } = data.payload
        const allowedGate = await ensureRunScriptAllowed()
        if (!allowedGate.ok) {
          send('error', allowedGate.error)
          return
        }
        const rootOverride = root ? path.resolve(root) : undefined
        const allowed = await getAllowedScripts(rootOverride)
        
        if (!allowed.includes(script)) {
          send('error', `Script not allowed: ${script}`)
          return
        }

        const cwd = getRoot(rootOverride)
        const env = getCodeAgentEnv()
        const result = await runSandboxNpmScript({
          script,
          args: Array.isArray(args) ? args.map(String) : undefined,
          cwd,
          timeoutMs: env.commandTimeoutMs
        })
        if (result.stdout) send('stdout', sanitize(result.stdout))
        if (result.stderr) send('stderr', sanitize(result.stderr))
        send('close', { code: result.ok ? 0 : result.exitCode ?? 1, sandbox: result.mode })
        return
      } else if (data.type === 'run-sandbox') {
        // SANDBOX: Execute arbitrary JavaScript in an isolated VM context
        const { code } = data.payload
        send('stdout', '> Starting sandbox execution...\n')
        
        try {
          const sandbox = { 
            console: {
              log: (...args: any[]) => send('stdout', args.map(String).join(' ') + '\n'),
              error: (...args: any[]) => send('stderr', args.map(String).join(' ') + '\n')
            },
            setTimeout,
            clearTimeout,
            process: { env: {} }
          }
          
          vm.createContext(sandbox)
          const script = new vm.Script(code)
          const result = script.runInContext(sandbox, { timeout: 5000 })
          
          if (result !== undefined) {
            send('stdout', `\nResult: ${JSON.stringify(result, null, 2)}\n`)
          }
          send('close', { code: 0 })
        } catch (e: any) {
          send('error', `Sandbox Error: ${e.message}\n`)
          send('close', { code: 1 })
        }
      } else if (data.type === 'agent-chat') {
        await handleAgentChat(data.payload, (event) => safeSend(event))
      } else if (data.type === 'get-audit') {
        const auditPath = path.join(process.cwd(), '.data', 'agent-audit.log')
        try {
          const content = await fs.readFile(auditPath, 'utf8')
          const lines = content.trim().split('\n').map(l => JSON.parse(l))
          send('audit-data', lines.reverse().slice(0, 100))
        } catch {
          send('audit-data', [])
        }
      }
    } catch (e) {
      console.error('WebSocket message error:', e)
      // IMPORTANT: always unblock the client UI when a message fails
      safeSend({ type: 'error', payload: sanitize((e as any)?.message ?? 'WebSocket message error') })
      safeSend({ type: 'done' })
    }
  },

  close(peer) {
    console.log('WebSocket client disconnected:', peer.id)
    const child = activeProcesses.get(peer.id)
    if (child) {
      try {
        child.kill()
      } catch {}
      activeProcesses.delete(peer.id)
    }
  }
})
