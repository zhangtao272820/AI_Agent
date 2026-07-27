/**
 * 复杂页面恢复逻辑冒烟
 */
import assert from 'node:assert/strict'
import {
  McpStallTracker,
  autoRecoverActions,
  buildStallRecoveryHint,
  complexPagePromptAddon,
  isComplexPageTask,
  isMcpAutoRecoverEnabled,
  isMcpStallRecoveryEnabled
} from '../server/services/mcpComplexRecovery'
import { isRecipeComplexPage, matchSiteRecipe } from '../server/services/siteRecipes'
import { loadLobsterSkillSection } from '../server/utils/lobsterSkillLoader'

assert(isMcpStallRecoveryEnabled(), 'stall recovery on')
assert(isMcpAutoRecoverEnabled(), 'auto recover on')

const tracker = new McpStallTracker()
const snap = '- link "Search" [ref=s1]\n- textbox [ref=s2]'
tracker.observeToolOutput('browser_snapshot', snap)
const s2 = tracker.observeToolOutput('browser_snapshot', snap)
assert(s2.stalled === true, 'detect stall')

const tools = [
  { name: 'browser_press_key', serverName: 'playwright', description: '', inputSchema: {} },
  { name: 'browser_wait', serverName: 'playwright', description: '', inputSchema: {} }
] as any
const acts = autoRecoverActions(1, tools)
assert(acts.length >= 1, 'auto recover actions')

const hint = buildStallRecoveryHint(2, tools)
assert(hint.includes('PageDown') || hint.includes('滚动'), 'hint has recovery')

assert(isComplexPageTask('Ant Design SPA 填表'), 'complex task detect')
assert(complexPagePromptAddon('iframe 页面', 'https://x.com').includes('复杂页面'), 'complex prompt')

assert(matchSiteRecipe('x', 'https://www.w3schools.com/')?.complex === true, 'w3schools complex')
assert(isRecipeComplexPage('填表', 'https://ant.design/'), 'antd complex recipe')

const rules = loadLobsterSkillSection('gui_standalone', 'McpRules')
assert(rules.includes('引擎:mcp'), 'standalone skill loaded')

console.log('smoke-complex-recovery: PASS')
