/**
 * P6 GUI 升级冒烟：经验回读、crawler→gui 回流、超时/重试
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(root, '..')

const { formatGuiExperienceBlock, isGuiExperienceReadEnabled, recallGuiExperience } = await import(
  pathToFileURL(path.join(repoRoot, 'shared/guiExperienceRetrieve.ts')).href
)
import {
  buildGuiHandoffStep,
  buildGuiHandoffTask,
  isGuiCrawlerHandoffEnabled,
  shouldInjectGuiAfterCrawler
} from '../../../server/graph/core/agent/guiCrawlerHandoff'
import { getGuiAutomationAddon } from '../../../server/graph/core/evolution/playbookPrompts'

function resolveGuiTimeoutMs(fallbackMs: number, task?: string): number {
  const base = Number(process.env.MANAGER_GUI_TIMEOUT_MS ?? 360_000)
  const configured = Number.isFinite(base) && base > 0 ? Math.floor(base) : 360_000
  const formMs = Number(process.env.MANAGER_GUI_TIMEOUT_FORM_MS ?? 360_000)
  const videoMs = Number(process.env.MANAGER_GUI_TIMEOUT_VIDEO_MS ?? 480_000)
  const t = String(task || '')
  const isForm = /(登录|填表|提交|OA|后台|表单)/i.test(t)
  const isVideo = /(播放|观看|视频|弹幕|B站|bilibili|哔哩)/i.test(t)
  let picked = configured
  if (isForm && Number.isFinite(formMs) && formMs > 0) picked = Math.max(picked, Math.floor(formMs))
  if (isVideo && Number.isFinite(videoMs) && videoMs > 0) picked = Math.max(picked, Math.floor(videoMs))
  return Math.max(picked, fallbackMs)
}

function nextGuiEngineHintForRetry(current?: string): string | undefined {
  const c = String(current || 'auto').trim().toLowerCase()
  if (!c || c === 'auto') return 'mcp'
  if (c === 'mcp') return 'stagehand'
  if (c === 'stagehand') return 'classic'
  return undefined
}

assert(fs.existsSync(path.join(root, 'skills/gui_automation/skill.md')), 'gui_automation skill exists')
assert(fs.existsSync(path.join(repoRoot, 'shared/guiExperienceRetrieve.ts')), 'guiExperienceRetrieve exists')

const addon = getGuiAutomationAddon()
assert(addon.includes('何时选 gui'), 'gui automation addon loads Route section')
assert(addon.includes('gui 步骤'), 'gui automation addon loads Planner section')

assert(isGuiExperienceReadEnabled(), 'gui experience read enabled by default')
assert(formatGuiExperienceBlock([]) === '', 'empty gui experience block')

const handoff = buildGuiHandoffStep({
  crawlerTask: '打开 https://example.com 登录',
  crawlerStepId: 's1',
  existingSteps: [{ id: 's1', agent: 'crawler', query: 'test' }]
})
assert(handoff?.agent === 'gui', 'handoff step is gui')
assert(handoff?.dependsOn?.includes('s1'), 'handoff depends on crawler')

assert(!buildGuiHandoffStep({
  crawlerTask: 'x',
  crawlerStepId: 's1',
  existingSteps: [
    { id: 's1', agent: 'crawler', query: 'a' },
    { id: 's2', agent: 'gui', query: 'b' }
  ]
}), 'no duplicate gui handoff')

assert(
  shouldInjectGuiAfterCrawler({
    routeSuggestion: 'gui',
    allowedAgents: ['crawler', 'gui'],
    existingSteps: [{ id: 's1', agent: 'crawler', query: 'a' }],
    env: { ...process.env, LOBSTER_AGENT_WS_URL: 'ws://localhost:13108/_ws', MANAGER_GUI_CRAWLER_HANDOFF: '1' }
  }),
  'inject when gui configured'
)

assert(buildGuiHandoffTask('抓取列表').includes('浏览器'), 'handoff task mentions browser')

const formMs = resolveGuiTimeoutMs(60_000, '登录 OA 填表')
assert(formMs >= 360_000, 'form timeout tier')

const videoMs = resolveGuiTimeoutMs(60_000, 'B站播放视频')
assert(videoMs >= 480_000, 'video timeout tier')

assert(nextGuiEngineHintForRetry('mcp') === 'stagehand', 'mcp→stagehand retry chain')
assert(nextGuiEngineHintForRetry('stagehand') === 'classic', 'stagehand→classic retry chain')

assert(String(process.env.MANAGER_GUI_RETRY_ON_ENGINE_FAIL ?? '1').trim() !== '0', 'engine retry env default on')

assert(isGuiCrawlerHandoffEnabled(), 'crawler handoff enabled by default')

const rows = await recallGuiExperience('百度搜索测试', { limit: 1 })
assert(Array.isArray(rows), 'recall returns array')

console.log('smoke-gui-upgrade: PASS')
