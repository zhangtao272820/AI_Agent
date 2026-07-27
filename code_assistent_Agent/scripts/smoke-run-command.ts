/**
 * P2-B5：受控终端白名单 smoke
 */
import { validateAllowlistedCommand } from '../server/utils/runCommand'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

assert(validateAllowlistedCommand(['git', 'status']).ok, 'git status allowed')
assert(validateAllowlistedCommand(['pnpm', 'typecheck']).ok, 'pnpm typecheck allowed')
assert(validateAllowlistedCommand(['rg', 'pattern', 'src']).ok, 'rg allowed')
assert(!validateAllowlistedCommand(['curl', 'http://evil']).ok, 'curl blocked')
assert(!validateAllowlistedCommand(['git', 'push']).ok, 'git push blocked')
assert(!validateAllowlistedCommand(['rm', '-rf', '/']).ok, 'rm blocked')

console.log('smoke-run-command: PASS')
