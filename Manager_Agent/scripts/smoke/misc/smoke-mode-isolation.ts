/**
 * P1 双模式隔离：learning / experience replay 分桶
 */
import {
  interactionModeMatches,
  orchestratorPromptModeBlock
} from '../../../server/graph/core/runtime/modeIsolate'
import { resolveManagerInteractionMode } from '../../../server/utils/platform/managerInteractionMode'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

process.env.MANAGER_MODE_ISOLATE = '1'
process.env.MANAGER_MODE_ISOLATE_LEARNING = '1'

assert(resolveManagerInteractionMode({ interactionMode: 'chat' }) === 'chat', 'chat mode')
assert(resolveManagerInteractionMode({ interactionMode: 'professional' }) === 'professional', 'pro mode')

assert(
  interactionModeMatches('chat', 'professional', { isolate: true }) === false,
  'chat signal blocked in pro'
)
assert(
  interactionModeMatches('professional', 'professional', { isolate: true }) === true,
  'pro signal allowed in pro'
)
assert(
  interactionModeMatches(undefined, 'professional', { isolate: true }) === true,
  'legacy untagged allowed'
)

const proBlock = orchestratorPromptModeBlock('professional')
assert(proBlock.includes('专业模式') && proBlock.includes('PU-Stack'), 'pro prompt block')
const chatBlock = orchestratorPromptModeBlock('chat')
assert(chatBlock.includes('对话模式'), 'chat prompt block')

console.log('smoke: mode-isolation ok')
