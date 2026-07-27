/**
 * P0-B / P1-A：TaskUnderstand schema · TaskSpec · 引擎链 smoke
 */
import {
  LobsterTaskUnderstandSchema,
  applyLobsterTaskUnderstand,
  toLobsterTaskSpec,
  taskSpecPromptAddon,
} from '../server/services/lobsterTaskUnderstandSchema'
import {
  taskSpecFromManagerHints,
  mergeManagerAndUnderstoodTaskSpec,
} from '../server/services/lobsterManagerTaskSpec'
import {
  buildEngineChainFromPick,
  reorderChainForTaskSpec,
  resolveEngineFromTaskSpec,
} from '../server/services/lobsterTaskSpec'
import {
  managedBrowserProfileDir,
  resolveBrowserProfile,
} from '../server/services/browserProfiles'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

const parsed = LobsterTaskUnderstandSchema.safeParse({
  canonical_task: '在百度搜索 LangGraph 并打开第一条结果',
  start_url: 'https://www.baidu.com',
  engine_hint: 'mcp',
  task_kind: 'search',
  browser_profile: 'managed',
  completion_criteria: '打开第一条搜索结果页',
  confidence: 0.9,
  rationale: '搜索+点击',
})
assert(parsed.success, 'schema parse v2')

const applied = applyLobsterTaskUnderstand(
  { task: '去百度搜 LangGraph', engineHint: 'auto' },
  parsed.data!,
)
assert(applied.startUrl?.includes('baidu'), 'start_url merged')
assert(applied.engineHint === 'auto', 'caller engineHint preserved (LLM hint soft via TaskSpec)')

const spec = toLobsterTaskSpec(parsed.data!, 'llm', 'managed')
assert(spec.task_kind === 'search', 'task_kind')
assert(spec.browser_profile === 'managed', 'browser_profile')
assert(spec.engine_hint === 'mcp', 'TaskSpec keeps LLM engine_hint')

const addon = taskSpecPromptAddon(spec)
assert(addon.includes('完成标准'), 'taskSpec prompt addon')

const picked = resolveEngineFromTaskSpec({
  spec,
  task: spec.canonical_task,
  startUrl: spec.start_url,
  engineHint: applied.engineHint,
  hasStorage: false,
})
assert(picked.engine === 'mcp', 'engine from taskSpec')
assert(picked.source === 'llm', 'LLM pick is soft (not forced)')

let chain = buildEngineChainFromPick(picked)
chain = reorderChainForTaskSpec(chain, spec, true)
assert(chain.includes('mcp'), 'search chain includes mcp')
assert(chain.includes('classic') && chain.length > 1, 'soft pick keeps classic fallback')

const forcedPick = resolveEngineFromTaskSpec({
  spec,
  task: spec.canonical_task,
  startUrl: spec.start_url,
  engineHint: 'mcp',
  hasStorage: false,
})
assert(forcedPick.source === 'forced', 'API engineHint=mcp is forced')
assert(buildEngineChainFromPick(forcedPick).length === 1, 'forced chain has no fallback')

const formSpec = toLobsterTaskSpec(
  {
    ...parsed.data!,
    task_kind: 'form_fill',
    needs_login: true,
    engine_hint: 'mcp',
  },
  'llm',
  'managed',
)
const formPicked = resolveEngineFromTaskSpec({ spec: formSpec, task: formSpec.canonical_task, hasStorage: true })
let formChain = buildEngineChainFromPick(formPicked)
formChain = reorderChainForTaskSpec(formChain, formSpec, true)
assert(formChain[0] === 'stagehand', 'form_fill + storage → stagehand first')

assert(resolveBrowserProfile({ LOBSTER_BROWSER_PROFILE: 'managed' }) === 'managed', 'profile managed')
assert(resolveBrowserProfile({ LOBSTER_BROWSER_PROFILE: 'user' }) === 'user', 'profile user')
assert(managedBrowserProfileDir('test_profile').includes('test_profile'), 'managed dir')

const desktopPicked = resolveEngineFromTaskSpec({
  spec: toLobsterTaskSpec(
    {
      canonical_task: '打开记事本输入 Hello',
      engine_hint: 'desktop',
      task_kind: 'desktop_app',
      target_app: 'Notepad',
      confidence: 0.9,
      rationale: 'desktop',
    },
    'llm',
    'managed',
  ),
  task: '打开记事本输入 Hello',
  hasStorage: false,
})
assert(desktopPicked.engine === 'desktop', 'desktop_app → desktop engine')

// 总管「手」：envelope task_kind 种子化 + 合并优先
const mgrForm = taskSpecFromManagerHints({
  task: '打开 httpbin 填 Customer name',
  startUrl: 'https://httpbin.org/forms/post',
  taskKind: 'form_fill',
  needsLogin: false,
})
assert(mgrForm?.task_kind === 'form_fill', 'manager hints form_fill')
assert(mgrForm?.source === 'manager', 'manager source')
const mgrPick = resolveEngineFromTaskSpec({
  spec: mgrForm!,
  task: mgrForm!.canonical_task,
  startUrl: mgrForm!.start_url,
  hasStorage: false,
})
assert(mgrPick.engine === 'stagehand', 'manager form_fill → stagehand soft')
assert(mgrPick.source !== 'forced', 'manager form_fill not forced')
assert(buildEngineChainFromPick(mgrPick).length > 1, 'form_fill keeps fallback')

const understoodAsSearch = toLobsterTaskSpec(
  {
    canonical_task: '打开 httpbin 填表',
    engine_hint: 'mcp',
    task_kind: 'search',
    confidence: 0.8,
    rationale: '误判 search',
    needs_login: false,
    explicitly_avoid_login: false,
    browser_profile: 'auto',
  },
  'llm',
  'managed',
)
const merged = mergeManagerAndUnderstoodTaskSpec(mgrForm, understoodAsSearch)
assert(merged?.task_kind === 'form_fill', 'manager priority over misunderstood search')
assert(merged?.engine_hint === 'auto', 'operate merge keeps engine_hint auto')

console.log('smoke-task-understand: PASS (TaskSpec + engine chain + browser profile + desktop + manager hand)')
