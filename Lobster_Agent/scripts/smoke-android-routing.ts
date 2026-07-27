/**
 * P2-C3：mobile 引擎路由 smoke（纯函数，不连接 adb device）
 */
import { requiresMobileEngine } from '../server/services/engineSelector'
import {
  buildEngineChainFromPick,
  resolveEngineFromTaskSpec,
} from '../server/services/lobsterTaskSpec'
import { toLobsterTaskSpec } from '../server/services/lobsterTaskUnderstandSchema'
import {
  isLobsterAndroidMcpEnabled,
  resolveLobsterAndroidMcpServers,
} from '../server/utils/lobster_env'
import { androidAutomationPromptAddon } from '../server/utils/lobsterSkillLoader'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

assert(requiresMobileEngine('在安卓手机上打开设置'), 'android settings → mobile guard')
assert(!requiresMobileEngine('打开百度', 'https://www.baidu.com'), 'http url skips mobile guard')

const spec = toLobsterTaskSpec(
  {
    canonical_task: '在安卓手机上打开设置应用',
    engine_hint: 'mobile',
    task_kind: 'mobile_app',
    target_app: 'Settings',
    confidence: 0.95,
    rationale: 'mobile smoke',
  },
  'llm',
  'managed',
)
assert(spec.task_kind === 'mobile_app', 'task_kind mobile_app')

const picked = resolveEngineFromTaskSpec({
  spec,
  task: spec.canonical_task,
  hasStorage: false,
})
assert(picked.engine === 'mobile', 'engine mobile from spec')
const chain = buildEngineChainFromPick(picked)
assert(chain.length === 1 && chain[0] === 'mobile', 'mobile chain no fallback')

const forced = resolveEngineFromTaskSpec({
  task: '任意任务',
  engineHint: 'mobile',
  hasStorage: false,
})
assert(forced.engine === 'mobile' && forced.source === 'forced', 'engine_hint mobile forced')

assert(!isLobsterAndroidMcpEnabled({ LOBSTER_ANDROID_MCP_ENABLED: '0' }), 'default disabled')
assert(isLobsterAndroidMcpEnabled({ LOBSTER_ANDROID_MCP_ENABLED: '1' }), 'enabled flag')
assert(
  resolveLobsterAndroidMcpServers({ LOBSTER_ANDROID_MCP_ENABLED: '0' }) === null,
  'servers null when disabled',
)

const addon = androidAutomationPromptAddon()
assert(addon.includes('执行规则') || addon.includes('ADB'), 'android skill loaded')

console.log('smoke-android-routing: PASS')
