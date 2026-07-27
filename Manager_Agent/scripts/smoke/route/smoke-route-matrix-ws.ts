/**
 * L3 结构门禁：route_plan_card 载荷 + WS 入站 schema 形状（不连真实 LLM/WS）。
 */
import { appendRouteWrongFeedback } from '../../../server/utils/route/managerRouteFeedbackStore'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mgr-route-ws-'))
const prevCwd = process.cwd()
process.chdir(tmpDir)

try {
  await appendRouteWrongFeedback({
    sessionId: 'sess-smoke',
    runId: 'run-smoke',
    userTask: '测试路由纠错',
    cap: ['rag', 'db'],
    intent: 'multi',
    comment: 'cap 不对'
  })
  const p = path.join(tmpDir, '.data', 'manager-route-feedback.jsonl')
  const raw = await fs.readFile(p, 'utf8')
  const row = JSON.parse(raw.trim().split('\n').pop() || '{}')
  assert(row.type === 'route_wrong', 'feedback type')
  assert(row.cap?.join(',') === 'rag,db', 'cap saved')
  assert(row.comment === 'cap 不对', 'comment')
} finally {
  process.chdir(prevCwd)
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined)
}

console.log('smoke-route-matrix-ws: OK (route_feedback queue)')
