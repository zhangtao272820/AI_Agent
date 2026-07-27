/**
 * 批次 E：LangGraph Checkpointer + RAG audit + DB metrics + E2E 集
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileManagerGraph } from '../../../server/graph/state/graph'
import {
  getManagerLangGraphCheckpointer,
  isManagerLangGraphCheckpointerEnabled,
  resetManagerLangGraphCheckpointerForTests,
  resolveLangGraphThreadId
} from '../../../server/graph/core/runtime/langgraphCheckpointer'
import { buildManagerGraphInvokeConfig } from '../../../server/graph/state/invokeConfig'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '../../..')

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

// P3-2: Checkpointer 默认关
delete process.env.MANAGER_LANGGRAPH_CHECKPOINTER
assert(!isManagerLangGraphCheckpointerEnabled(), 'checkpointer default off')
assert(!getManagerLangGraphCheckpointer(), 'no saver when off')

process.env.MANAGER_LANGGRAPH_CHECKPOINTER = '1'
resetManagerLangGraphCheckpointerForTests()
assert(isManagerLangGraphCheckpointerEnabled(), 'checkpointer opt-in')
assert(Boolean(getManagerLangGraphCheckpointer()), 'saver when on')
const tid = resolveLangGraphThreadId({ runId: 'run-test', sessionId: 'sess-x' })
assert(tid === 'run-run-test', 'thread id per run (memory mode)')

process.env.MANAGER_LANGGRAPH_CHECKPOINTER = 'postgres'
resetManagerLangGraphCheckpointerForTests()
const tidPg = resolveLangGraphThreadId({ runId: 'run-test', sessionId: 'sess-x' })
assert(tidPg === 'run-run-test', 'postgres mode: runId wins over sess-*')
const tidSessOnly = resolveLangGraphThreadId({ sessionId: 'sess-x' })
assert(tidSessOnly === 'sess-sess-x', 'postgres fallback sess when no runId')

process.env.MANAGER_LANGGRAPH_CHECKPOINTER = '1'
resetManagerLangGraphCheckpointerForTests()

const cfg = buildManagerGraphInvokeConfig({ runId: 'abc', sessionId: 's1' }) as {
  configurable?: { thread_id?: string }
}
assert(cfg.configurable?.thread_id === 'run-abc', 'invoke config thread_id')

// compile 可挂载 checkpointer（结构 smoke）
const noop = async () => ({})
const nodes = {
  resourceNode: noop,
  toolHealthNode: noop,
  turnScopeNode: noop,
  probeNode: noop,
  metacogNode: noop,
  securityNode: noop,
  decomposeNode: noop,
  intentClassifyNode: noop,
  routerNode: noop,
  orchestrateNode: noop,
  prefetchNode: noop,
  webSearchNode: noop,
  clarifyNode: noop,
  planNode: noop,
  schedulerNode: noop,
  executionModeNode: noop,
  voteAggregatorNode: noop,
  dbNode: noop,
  ragNode: noop,
  codeNode: noop,
  adminNode: noop,
  crawlerNode: noop,
  guiNode: noop,
  mcpToolNode: noop,
  cleanNode: noop,
  visualizeNode: noop,
  reportNode: noop,
  multimodalNode: noop,
  musicNode: noop,
  videoNode: noop,
  multiNode: noop,
  adminConfirmResumeNode: noop,
  planLinterNode: noop,
  planPreviewNode: noop,
  synthNode: noop,
  evaluatorNode: noop,
  criticNode: noop,
  optimizerNode: noop,
  verifierNode: noop,
  monitorNode: noop,
  finalizeNode: noop,
  fixNode: noop
}
const { Annotation } = await import('@langchain/langgraph')
const GraphState = Annotation.Root({})
const compiled = compileManagerGraph(GraphState, nodes as any, {
  checkpointer: getManagerLangGraphCheckpointer()
})
assert(typeof compiled.invoke === 'function', 'graph compiles with checkpointer')

delete process.env.MANAGER_LANGGRAPH_CHECKPOINTER
resetManagerLangGraphCheckpointerForTests()

const e2eRaw = await fs.readFile(path.join(root, 'eval', 'golden-e2e-paths.json'), 'utf8')
const e2e = JSON.parse(e2eRaw) as { cases?: unknown[] }
assert(Array.isArray(e2e.cases) && e2e.cases.length >= 10, 'golden e2e >= 10 cases')

console.log('smoke: batch-e ok')
