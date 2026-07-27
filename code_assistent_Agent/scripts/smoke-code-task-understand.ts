/**
 * P0-C：codeTaskUnderstand schema 与 envelope → task_kind 接入 smoke
 */
import { CodeTaskUnderstandSchema, isCodeTaskUnderstandEnabled } from '../server/utils/codeTaskUnderstandSchema'
import {
  buildManagerTaskEnvelope,
  parseManagerTaskEnvelope,
  serializeManagerTaskEnvelope,
} from '../../shared/managerTaskEnvelope'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

const parsed = CodeTaskUnderstandSchema.safeParse({
  task_kind: 'edit',
  refined_question: '在 RAG_Agent 添加 BM25 开关并 typecheck',
  hint_files: ['RAG_Agent/server/utils/retrieval.ts'],
  write_allowed: true,
  confidence: 0.88,
  rationale: '用户要求改仓库并验证',
})
assert(parsed.success, 'schema parse')

const envelope = buildManagerTaskEnvelope({
  target_agent: 'code',
  trace_id: 't1',
  session_id: 's1',
  utterance: '在 RAG_Agent 添加 BM25 开关',
  payload: {
    kind: 'code',
    data: {
      source: 'manager',
      task_kind: 'edit',
      refined_question: '在 RAG_Agent 添加 BM25 开关',
      write_allowed: true,
    },
  },
})

const roundtrip = parseManagerTaskEnvelope(serializeManagerTaskEnvelope(envelope))
assert(roundtrip?.payload.kind === 'code', 'envelope roundtrip')
const data = roundtrip?.payload.data as { task_kind?: string; write_allowed?: boolean }
assert(data.task_kind === 'edit', `envelope edit got ${data.task_kind}`)
assert(data.write_allowed === true, 'write_allowed')

process.env.CODE_TASK_UNDERSTAND = '1'
assert(isCodeTaskUnderstandEnabled(), 'understand enabled by default')

console.log('smoke-code-task-understand: PASS')
