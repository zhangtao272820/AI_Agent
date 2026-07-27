/**
 * 不调用 LLM：仅验证 LangGraph 图能成功 compile，避免 StateGraph 等漏 import 的运行时崩溃。
 */
import { Annotation } from '@langchain/langgraph'
import { compileManagerGraph } from '../../../server/graph/state/graph'

const noop = async () => ({})
const GraphState = Annotation.Root({})

compileManagerGraph(GraphState, {
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
  webSearchNode: noop,
  prefetchNode: noop,
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
})

console.log('smoke: manager graph compile ok')
