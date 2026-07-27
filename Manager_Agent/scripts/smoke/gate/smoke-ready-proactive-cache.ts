/**
 * 轻量回归：proactive GET 只读缓存；memory status TTL 缓存命中。
 * 不依赖在线 Docker。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const proactiveUrl = pathToFileURL(path.join(root, 'server/graph/core/task/proactiveLoop.ts')).href
const sessionUrl = pathToFileURL(path.join(root, 'server/utils/session/managerSessionStore.ts')).href

const {
  getPendingProactiveNudges,
  refreshProactiveNudgesForSession
} = await import(proactiveUrl)

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mgr-proactive-'))
const sid = 'smoke_sess_ro'
const nudgeDir = path.join(tmp, 'proactive-nudges')
await fs.mkdir(nudgeDir, { recursive: true })
await fs.writeFile(
  path.join(nudgeDir, `${sid}.json`),
  JSON.stringify([
    {
      id: 'n1',
      sessionId: sid,
      title: 't',
      reason: 'low_composite_score',
      message: '上一轮综合质量分较低（0.27），建议针对 clarify_needed 补充约束或重试。',
      priority: 'high',
      createdAt: new Date().toISOString()
    },
    {
      id: 'n2',
      sessionId: sid,
      title: 'done',
      reason: 'overdue',
      message: 'consumed',
      priority: 'low',
      createdAt: new Date().toISOString(),
      consumed: true
    }
  ]),
  'utf8'
)

const pending = await getPendingProactiveNudges(tmp, sid)
assert.equal(pending.length, 1, 'GET path returns only unconsumed')
assert.equal(pending[0]?.id, 'n1')

// refresh should still work (may rewrite file); ensure exported
assert.equal(typeof refreshProactiveNudgesForSession, 'function')

const { getManagerMemoryStatus } = await import(sessionUrl)
const a = await getManagerMemoryStatus()
const t0 = Date.now()
const b = await getManagerMemoryStatus()
const dt = Date.now() - t0
assert.equal(a.backend, b.backend)
assert.ok(dt < 50, `cached memory status should be cheap, got ${dt}ms`)

await fs.rm(tmp, { recursive: true, force: true })
console.log('ok: proactive read-only + memory status TTL')
