import { getSandboxMode, runSandboxNpmScript } from '../server/utils/sandbox_runner'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

assert(getSandboxMode() === 'subprocess' || getSandboxMode() === 'off' || getSandboxMode() === 'docker', 'sandbox mode')

const prev = process.env.CODE_SANDBOX_MODE
process.env.CODE_SANDBOX_MODE = 'subprocess'
const bad = await runSandboxNpmScript({
  script: '__smoke_missing_script__',
  cwd: process.cwd(),
  timeoutMs: 8_000
})
assert(!bad.ok, 'missing script should fail safely')
if (prev === undefined) delete process.env.CODE_SANDBOX_MODE
else process.env.CODE_SANDBOX_MODE = prev

console.log('smoke: code sandbox ok')
