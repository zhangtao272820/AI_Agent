/**
 * 引擎选型冒烟：Recipe · hard_guard · resolveEngineFromTaskSpec 软链（非死路径 LLM 分类器）
 */
import assert from 'node:assert/strict'
import {
  matchSiteRecipe,
  recipePreferredEngine,
  siteHintsForPrompt,
  stagehandHintsForPrompt,
} from '../server/services/siteRecipes'
import { selectEngineForTask, engineFallbackChain, requiresClassicEngine } from '../server/services/engineSelector'
import {
  resolveEngineFromTaskSpec,
  buildEngineChainFromPick,
} from '../server/services/lobsterTaskSpec'
import { formatStagehandModelName } from '../server/utils/lobster_env'

assert(matchSiteRecipe('打开百度', 'https://www.baidu.com/')?.id === 'baidu', 'baidu recipe')
assert(recipePreferredEngine('填表', 'https://ant.design/components/form-cn') === 'stagehand', 'antd→stagehand')
assert(siteHintsForPrompt('test', 'https://www.runoob.com/').includes('runoob'), 'mcp hints')
assert(stagehandHintsForPrompt('test', 'https://ant.design/').includes('Stagehand'), 'stagehand hints')

assert(selectEngineForTask('B站播放视频') === 'classic', 'video→classic regex')
assert(
  selectEngineForTask('打开 bilibili 点赞', 'https://www.bilibili.com/video/BV1') === 'classic',
  'bili engagement→classic',
)
assert(requiresClassicEngine('搜索后观看 5 秒', 'https://www.bilibili.com/'), 'watch on bili requires classic')
assert(selectEngineForTask('登录 OA 填表') === 'stagehand', 'form→stagehand regex')
assert(selectEngineForTask('百度搜索') === 'mcp', 'search→mcp regex')

const baiduVideo = selectEngineForTask('B站播放', 'https://www.baidu.com/')
assert(baiduVideo === 'classic', 'video keyword wins on baidu host')

const recipeAligned =
  recipePreferredEngine('搜索 Python', 'https://www.baidu.com/') ===
  selectEngineForTask('搜索 Python', 'https://www.baidu.com/')
assert(recipeAligned, 'baidu recipe aligns with regex for search')

assert(engineFallbackChain('mcp')[0] === 'mcp', 'mcp chain')
assert(engineFallbackChain('stagehand').includes('mcp'), 'stagehand fallback includes mcp')

// TaskUnderstand 软选型：LLM engine_hint ≠ forced，须保留 fallback
const softPick = resolveEngineFromTaskSpec({
  task: '百度搜 Python',
  startUrl: 'https://www.baidu.com/',
  spec: {
    canonical_task: '百度搜 Python',
    engine_hint: 'mcp',
    task_kind: 'search',
    confidence: 0.85,
    source: 'llm',
    rationale: 'soft',
  } as any,
})
assert(softPick.source !== 'forced', 'llm hint is soft')
assert(buildEngineChainFromPick(softPick).length > 1, 'soft pick keeps fallback chain')

const forcedPick = resolveEngineFromTaskSpec({
  task: 'x',
  engineHint: 'classic',
})
assert(forcedPick.source === 'forced', 'caller engineHint is forced')
assert(buildEngineChainFromPick(forcedPick).length === 1, 'forced chain has no fallback')

assert(formatStagehandModelName('qwen3.5-flash') === 'openai/qwen3.5-flash', 'stagehand model prefix')
assert(formatStagehandModelName('openai/gpt-4o') === 'openai/gpt-4o', 'stagehand model passthrough')

console.log('smoke-engine-classifier: PASS')
