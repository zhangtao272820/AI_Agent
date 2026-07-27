/**
 * P2-B4：Git 隔离 smoke（纯函数，不修改仓库）
 */
import { resolveAgentWorktreeMode } from '../server/utils/codeGitWorktree'
import { validateAllowlistedCommand } from '../server/utils/runCommand'
import { parseComposerMentions } from '../server/utils/composerMentions'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

assert(resolveAgentWorktreeMode({ CODE_AGENT_WORKTREE: '0' }) === 'off', 'default off')
assert(resolveAgentWorktreeMode({ CODE_AGENT_WORKTREE: 'branch' }) === 'branch', 'branch mode')
assert(resolveAgentWorktreeMode({ CODE_AGENT_WORKTREE: 'worktree' }) === 'worktree', 'worktree mode')
assert(resolveAgentWorktreeMode({ CODE_AGENT_WORKTREE: '1' }) === 'worktree', '1 → worktree')

assert(validateAllowlistedCommand(['git', 'worktree', 'list']).ok, 'git worktree list allowed')

const mentions = parseComposerMentions('改 @file:server/services/agent.ts 并 typecheck 绿')
assert(mentions.hintFiles.includes('server/services/agent.ts'), '@file parsed')

console.log('smoke-code-git-isolation: PASS')
