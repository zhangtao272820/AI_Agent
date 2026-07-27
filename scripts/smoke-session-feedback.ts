/**
 * Smoke: agent_session_feedback PG 持久化生命周期
 * 用法：cd Manager_Agent && npx tsx ../scripts/smoke-session-feedback.ts
 */
import {
  upsertSessionFeedback,
  listSessionFeedback,
  deleteSessionFeedbackFromTurn,
  deleteSessionFeedbackFromUserIndex,
  deleteAllSessionFeedback,
  turnFeedbackKey,
  type AgentFeedbackAgent
} from '../shared/sessionFeedbackStore'
import { isAgentPgConfigured, agentPgQuery } from '../shared/agentPgClient'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`[smoke-session-feedback] ${msg}`)
}

const AGENTS: AgentFeedbackAgent[] = ['manager', 'db', 'rag', 'admin']

async function main() {
  if (!isAgentPgConfigured()) {
    console.error('AGENT_DATABASE_URL not set')
    process.exit(1)
  }

  const tableCheck = await agentPgQuery<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'agent_session_feedback'
     ) AS exists`
  )
  assert(tableCheck?.rows?.[0]?.exists, 'agent_session_feedback table missing — run migrations first')

  const sessionId = `smoke_fb_${Date.now()}`
  console.log(`smoke-session-feedback: session=${sessionId}`)

  for (const agent of AGENTS) {
    const ok1 = await upsertSessionFeedback({
      agent,
      sessionId,
      feedbackKey: turnFeedbackKey(1),
      score: agent === 'manager' ? 1 : 1,
      turnId: 1,
      userMessageIndex: 0,
      question: `smoke ${agent} t1`
    })
    assert(ok1, `upsert ${agent} turn 1`)

    const ok3 = await upsertSessionFeedback({
      agent,
      sessionId,
      feedbackKey: turnFeedbackKey(3),
      score: agent === 'manager' ? 0 : -1,
      turnId: 3,
      userMessageIndex: 2,
      question: `smoke ${agent} t3`,
      comment: agent === 'db' ? 'wrong sql' : null
    })
    assert(ok3, `upsert ${agent} turn 3`)
  }

  for (const agent of AGENTS) {
    const items = await listSessionFeedback(agent, sessionId)
    assert(items.length === 2, `${agent} list: expected 2, got ${items.length}`)
    const t1 = items.find((it) => it.turnId === 1)
    assert(t1 && (agent === 'manager' ? t1.score === 1 : t1.score === 1), `${agent} turn1 score`)
  }

  const delTurn = await deleteSessionFeedbackFromTurn('db', sessionId, 3)
  assert(delTurn >= 1, `db deleteFromTurn deleted=${delTurn}`)
  const dbAfterTurn = await listSessionFeedback('db', sessionId)
  assert(dbAfterTurn.length === 1 && dbAfterTurn[0].turnId === 1, 'db only turn1 remains')

  const delIdx = await deleteSessionFeedbackFromUserIndex('manager', sessionId, 2)
  assert(delIdx >= 1, `manager deleteFromUserIndex deleted=${delIdx}`)
  const mgrAfter = await listSessionFeedback('manager', sessionId)
  assert(mgrAfter.length === 1 && mgrAfter[0].turnId === 1, 'manager only turn1 remains')

  const delAllRag = await deleteAllSessionFeedback('rag', sessionId)
  assert(delAllRag >= 1, `rag deleteAll deleted=${delAllRag}`)
  assert((await listSessionFeedback('rag', sessionId)).length === 0, 'rag session empty')

  await deleteAllSessionFeedback('admin', sessionId)
  await deleteAllSessionFeedback('db', sessionId)
  await deleteAllSessionFeedback('manager', sessionId)

  console.log('smoke-session-feedback: all passed')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
