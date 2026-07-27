/**
 * 跨 Agent turn_scope 协议 smoke（runtime + 静态契约）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildTurnScopePayload,
  parseTurnScopePayload,
} from '../../../server/utils/route/managerTurnScopePayload'
import { buildOutputFollowupNarrowHistory } from '../../../server/graph/core/output/outputFollowupHistory'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../../../..')

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(`[smoke-turn-scope-protocol] ${msg}`)
}

function readSource(rel: string): string {
  return fs.readFileSync(path.join(repoRoot, rel), 'utf8')
}

// runtime：output_followup payload
const narrow = buildTurnScopePayload('current_only', 'output_followup')
assert(narrow.narrow_output_followup === true, 'narrow flag')
assert(narrow.suppress_history === false, 'narrow allows history channel')

const hist = buildOutputFollowupNarrowHistory(
  [
    { role: 'user', content: '查服务比对' },
    { role: 'assistant', content: '上轮结果：环境指标 vs 汇总指标' },
    { role: 'user', content: '同上面是哪种' },
  ],
  '同上面是哪种'
)
assert(hist.length === 1 && hist[0]?.role === 'assistant', 'narrow history assistant only')

const isolated = buildTurnScopePayload('current_only', 'new_task')
assert(isolated.suppress_history === true, 'isolated suppresses history')

const roundtrip = parseTurnScopePayload(JSON.parse(JSON.stringify(narrow)))
assert(roundtrip?.turn_kind === 'output_followup', 'turn_scope roundtrip')

// 静态：shared SSOT 导出与子 Agent 消费
const sharedSrc = readSource('shared/turnScope.ts')
assert(sharedSrc.includes('resolveOrchestratedClientHistory'), 'shared resolver export')
assert(sharedSrc.includes('allowsOrchestratedDialogMerge'), 'shared merge gate export')

const ragClientSrc = readSource('Manager_Agent/server/utils/agents/ragClient.ts')
assert(ragClientSrc.includes('resolveOrchestratedClientHistory'), 'ragClient uses resolver')

const ragChatSrc = readSource('RAG_Agent/server/api/chat.post.ts')
assert(ragChatSrc.includes('resolveOrchestratedClientHistory'), 'RAG chat uses resolver')
assert(ragChatSrc.includes('allowsOrchestratedDialogMerge'), 'RAG chat merge gate')

const dbCtxSrc = readSource('DB_Agent/utils/manager_task_context.ts')
assert(dbCtxSrc.includes('narrow_output_followup'), 'DB respects narrow_output_followup')

const adminSrc = readSource('AI_admin_Agent/backend/app/core/admin_turn_scope.py')
assert(adminSrc.includes('scope_from_manager_turn_scope'), 'Admin accepts manager turn_scope')

const adminPayloadSrc = readSource('Manager_Agent/server/utils/admin/managerAdminTaskPayload.ts')
assert(adminPayloadSrc.includes('turn_scope'), 'Manager admin payload carries turn_scope')

console.log('smoke-turn-scope-protocol: OK')
