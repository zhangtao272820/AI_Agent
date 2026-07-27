/**
 * §3.6 协同契约 smoke：session 桥接、RAG 编排 history=[]、AMP 常量。
 * CI：npm run smoke:memory-coordination
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildDbHistoryFromState, resolveManagerAgentSessionId } from '../../../server/graph/core/runtime/sessionBridge'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../../../..')

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`[smoke-memory-coordination] ${msg}`)
}

function readSource(rel: string): string {
  return fs.readFileSync(path.join(repoRoot, rel), 'utf8')
}

console.log('smoke-memory-coordination: start')

// §3.1 sessionId 解析顺序
assert(
  resolveManagerAgentSessionId({ sessionId: 's1', ragConversationId: 'r1', runId: 'x' }) === 's1',
  'sessionId must win'
)
assert(
  resolveManagerAgentSessionId({ sessionId: '', ragConversationId: 'r1', runId: 'x' }) === 'r1',
  'ragConversationId fallback'
)
assert(
  resolveManagerAgentSessionId({ sessionId: '', ragConversationId: '', runId: 'x' }) === 'mgr-x',
  'mgr-{runId} fallback'
)

// §3.2 DB history ≤8 轮
const dbHist = buildDbHistoryFromState(
  Array.from({ length: 30 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `t${i}`
  })),
  '当前问'
)
assert(dbHist.length <= 17, 'DB history should cap at 8 turns + current')
assert(dbHist[dbHist.length - 1]?.content === '当前问', 'current question appended')

// output_followup：DB 仅窄 assistant + 当前问
const followupDb = buildDbHistoryFromState(
  [
    { role: 'user', content: '查比对' },
    { role: 'assistant', content: '环境指标 vs 汇总指标' },
    { role: 'user', content: '同上面是哪种' }
  ],
  '同上面是哪种',
  { turnScopeMode: 'current_only', turnKind: 'output_followup' }
)
assert(followupDb.length === 2, 'output_followup DB history = assistant + current')
assert(followupDb[0]?.role === 'assistant', 'output_followup keeps assistant only')

// §3.2 RAG 编排 history（output_followup 传窄 history，默认仍为空）
const ragClientSrc = readSource('Manager_Agent/server/utils/agents/ragClient.ts')
assert(ragClientSrc.includes('resolveOrchestratedClientHistory'), 'ragClient uses turn_scope history resolver')
assert(ragClientSrc.includes("'x-manager-orchestrated': '1'"), 'ragClient must set orchestrated header')

const ragChatSrc = readSource('RAG_Agent/server/api/chat.post.ts')
assert(
  ragChatSrc.includes('resolveOrchestratedClientHistory'),
  'RAG chat must resolve orchestrated history from turn_scope'
)

// AMP 文档化常量（静态检查 shared 模块存在）
const ampSrc = readSource('shared/agentMemoryPolicy.ts')
assert(ampSrc.includes('AMP_POLICY_VERSION'), 'AMP policy module present')
assert(ampSrc.includes('sessionTurnsMax: 200'), 'session turns cap in AMP')

const userKeySrc = readSource('shared/resolveUserKey.ts')
assert(userKeySrc.includes('__global__'), 'user_key fallback')

console.log('smoke-memory-coordination: OK')
