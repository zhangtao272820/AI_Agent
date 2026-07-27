/**
 * Restore a WS handler body from dispatchIncomingMessage.ts.bak (UTF-8 safe).
 */
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const bak = path.join(root, 'server/api/manager-ws/dispatchIncomingMessage.ts.bak')
const handlersDir = path.join(root, 'server/api/manager-ws/handlers')
const importBlock = fs.readFileSync(path.join(handlersDir, 'types.ts'), 'utf8').includes('WsHandlerContext')
  ? null
  : null

const bakLines = fs.readFileSync(bak, 'utf8').split(/\r?\n/)
const headerEnd = 86
const importLines = bakLines.slice(0, headerEnd)
  .join('\n')
  .replaceAll("from '../../utils/", "from '../../../utils/")
  .replaceAll("from './schemas'", "from '../schemas'")
  .replaceAll("from './runtimeState'", "from '../runtimeState'")
  .replaceAll("from './wsSessionHelpers'", "from '../wsSessionHelpers'")
  .replaceAll("await import('../../utils/", "await import('../../../utils/")

const handlers = [
  ['handleResume', 157, 185],
  ['handleClearExperience', 186, 195],
  ['handleRouteFeedback', 196, 262],
  ['handleFeedback', 263, 363],
  ['handleWithdrawTurn', 364, 394],
  ['handleCancel', 395, 417],
  ['handlePlanConfirm', 419, 445],
  ['handleHumanConfirm', 447, 660],
  ['handleChat', 662, 920]
]

for (const [fn, start, end] of handlers) {
  let body = bakLines.slice(start - 1, end).join('\n')
  if (fn !== 'handleChat') {
    body = body.replace(/^\s{6}if \(type === '[^']+'\) \{\r?\n/, '')
    body = body.replace(/\n\s{6}return\s*$/, '')
    body = body.replace(/\}\s*$/, '')
  }
  body = body.replace(/^\s{6}/gm, '  ').trim()

  const file = `${importLines}
import type { WsHandlerContext, ParsedWsMessage } from './types'

export async function ${fn}(ctx: WsHandlerContext, payload: ParsedWsMessage) {
  const { peer, peerKey, send, sessionId, boundUserId, tenantId, explicitUserId, platformTraceId, payloadRaw } = ctx

${body}
}
`
  fs.writeFileSync(path.join(handlersDir, `${fn}.ts`), file, 'utf8')
}

console.log('restore-ws-handlers-from-bak: ok')
