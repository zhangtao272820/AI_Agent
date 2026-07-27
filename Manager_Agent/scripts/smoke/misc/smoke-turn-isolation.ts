/**
 * 每轮对话隔离：checkpointer thread + multi 不继承旧 results
 */
import {
  resolveLangGraphThreadId,
  resetManagerLangGraphCheckpointerForTests
} from '../../../server/graph/core/runtime/langgraphCheckpointer'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

process.env.MANAGER_LANGGRAPH_CHECKPOINTER = 'postgres'
resetManagerLangGraphCheckpointerForTests()
assert(
  resolveLangGraphThreadId({ runId: 'a', sessionId: 'same-session' }) === 'run-a',
  'each run gets isolated thread'
)
assert(
  resolveLangGraphThreadId({ runId: 'b', sessionId: 'same-session' }) === 'run-b',
  'second turn different thread'
)

console.log('smoke-turn-isolation: OK')
