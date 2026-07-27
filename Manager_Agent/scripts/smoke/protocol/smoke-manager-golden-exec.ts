/**
 * P0-D · Wave 2 黄金路径结构 smoke（不调用 LLM / 外部 Agent）
 *
 * 覆盖总路线图 §5：
 *  - 路径 2：gui envelope（百度搜索 LangGraph）
 *  - 路径 3：code(edit) task_kind + write_allowed
 */
import {
  buildManagerTaskEnvelope,
  parseManagerTaskEnvelope,
  serializeManagerTaskEnvelope,
} from '#agent-shared/managerTaskEnvelope'
import { parseOrchestratorJson } from '../../../server/graph/llm/taskOrchestrator/parseCore'
import { buildManagerCodeTaskPayload } from '../../../server/utils/code/managerCodeTaskPayload'
import { resolveManagerCodeTaskKind } from '../../../server/utils/code/resolveManagerCodeTaskKind'
import { extractStartUrlFromTask } from '../../../server/graph/core/agent/guiTaskPayload'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

// —— 黄金路径 2：gui envelope ——
const guiTask = '去百度搜索 LangGraph 并打开第一条结果'
const guiStart = extractStartUrlFromTask(guiTask) ?? 'https://www.baidu.com'
const guiEnvelope = buildManagerTaskEnvelope({
  target_agent: 'gui',
  trace_id: 'golden-gui-1',
  session_id: 'sess-gui-1',
  utterance: guiTask,
  turn_scope: {
    mode: 'current_only',
    suppress_history: true,
    suppress_anchor: true,
    suppress_experience_replay: true,
  },
  payload: {
    kind: 'gui',
    data: {
      source: 'manager',
      task: guiTask,
      startUrl: guiStart,
      engineHint: 'mcp',
    },
  },
})
const guiParsed = parseManagerTaskEnvelope(serializeManagerTaskEnvelope(guiEnvelope))
assert(guiParsed?.payload.kind === 'gui', 'gui envelope kind')
const guiData = guiParsed!.payload.data as { task?: string; startUrl?: string; engineHint?: string }
assert(guiData.task?.includes('百度'), 'gui task preserved')
assert(guiData.engineHint === 'mcp', 'gui engineHint')

const guiOrchestrator = parseOrchestratorJson(
  JSON.stringify({
    turnScopeMode: 'current_only',
    clauses: [{ id: 'c1', text: guiTask, agents: ['gui'] }],
    dataSources: ['crawler'],
    suggestedAgents: ['gui', 'crawler'],
    allowedAgents: ['gui', 'crawler'],
    needsWeb: true,
    isMulti: false,
    intent: 'gui',
    routedQuery: guiTask,
    planBlueprint: {
      rationale: 'gui search',
      steps: [{ agent: 'gui', queryFocus: '百度搜索 LangGraph 并打开第一条' }],
    },
    confidence: 0.85,
  }),
  guiTask,
)
assert(guiOrchestrator.raw?.allowedAgents.includes('gui'), 'orchestrator gui cap')

// —— 黄金路径 3：code(edit) ——
const codeTask = '在 RAG_Agent 增加 BM25 开关并运行 typecheck'
const codeOrchestrator = parseOrchestratorJson(
  JSON.stringify({
    turnScopeMode: 'current_only',
    clauses: [{ id: 'c1', text: codeTask, agents: ['code'] }],
    suggestedAgents: ['code'],
    allowedAgents: ['code'],
    isMulti: false,
    intent: 'code',
    routedQuery: codeTask,
    codeMode: 'edit',
    planBlueprint: {
      rationale: 'repo edit',
      steps: [{ agent: 'code', queryFocus: '在 RAG_Agent 增加 BM25 开关', codeMode: 'edit' }],
    },
    confidence: 0.9,
  }),
  codeTask,
)
assert(codeOrchestrator.raw?.codeMode === 'edit', 'top-level codeMode preserved')
const codeStep = codeOrchestrator.raw?.planBlueprint?.steps.find((s) => s.agent === 'code')
assert((codeStep as { codeMode?: string })?.codeMode === 'edit', 'blueprint codeMode preserved')

const meta = {
  codeMode: codeOrchestrator.raw?.codeMode,
  planBlueprint: codeOrchestrator.raw?.planBlueprint,
}
const taskKind = resolveManagerCodeTaskKind({ question: codeTask, meta })
assert(taskKind === 'edit', `code edit taskKind got ${taskKind}`)

const codePayload = buildManagerCodeTaskPayload({
  question: codeTask,
  taskKind,
  meta,
})
assert(codePayload?.task_kind === 'edit', 'payload task_kind edit')
assert(codePayload?.write_allowed === true, 'write_allowed for edit')

const codeEnvelope = buildManagerTaskEnvelope({
  target_agent: 'code',
  trace_id: 'golden-code-1',
  session_id: 'sess-code-1',
  utterance: codeTask,
  payload: { kind: 'code', data: codePayload! },
})
const codeEnvParsed = parseManagerTaskEnvelope(serializeManagerTaskEnvelope(codeEnvelope))
const codeEnvData = codeEnvParsed?.payload.data as { task_kind?: string; write_allowed?: boolean }
assert(codeEnvData.task_kind === 'edit', 'code envelope task_kind')

// —— 路径 1 不退化：db→code(compute) ——
const upstream = 'db:\n结构化事实\n  - 销售额：100（db）'
const computeKind = resolveManagerCodeTaskKind({
  question: '汇总销售并准备图表',
  upstreamContext: upstream,
  meta: { codeMode: 'compute' },
})
assert(computeKind === 'compute', 'upstream pipeline stays compute')

console.log('smoke-manager-golden-exec: PASS (gui + code edit + compute)')
