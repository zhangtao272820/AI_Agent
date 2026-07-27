/**
 * P2-B3：@file / @folder 解析 smoke
 */
import { parseComposerMentions } from '../server/utils/composerMentions'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

const a = parseComposerMentions('解释 @file:server/services/agent.ts 入口')
assert(a.hintFiles.includes('server/services/agent.ts'), '@file: path')
assert(a.cleanMessage.includes('解释'), 'clean message keeps text')

const b = parseComposerMentions('看 @app/app.vue 并改 @folder:server/utils')
assert(b.hintFiles.some((f) => f.endsWith('app.vue')), 'short @file')
assert(b.hintFolders.includes('server/utils'), '@folder')

console.log('smoke-composer-mentions: PASS')
