import { applyWebExecutionModeToRoute } from '../../../server/utils/search/managerWebExecutionModeLlm'
import { sanitizeVisionAnswer } from '../../../server/utils/media/managerVisionSanitize'
import { polishUserFacingAnswer } from '../../../server/graph/core/output/replyPolish'
import { inferSerpOnlyStructural } from '../../../server/utils/crawler/managerCrawlerSerpOnlyLlm'
import { normalizeModelReplyHtml } from '#agent-shared/replyHtmlNormalize'

const q = '打开百度搜索「Python 教程」，提取第一条结果'

const guiMode = {
  mode: 'gui' as const,
  primaryAgent: 'gui' as const,
  needsWebSearch: false,
  serpSummaryEnough: false,
  confidence: 0.9,
  rationale: 'browser interaction'
}
const gui = applyWebExecutionModeToRoute({
  intent: 'crawler',
  allowedAgents: ['crawler'],
  llmNeedsWebSearch: true,
  mode: guiMode
})
if (gui.intent !== 'gui' || gui.llmNeedsWebSearch !== false || !gui.allowedAgents.includes('gui')) {
  throw new Error(`applyWebExecutionModeToRoute gui failed: ${JSON.stringify(gui)}`)
}

const serp = inferSerpOnlyStructural(q, {
  serpContext: 'x',
  searchHits: [{}],
  webExecutionMode: guiMode,
  allowedAgents: ['gui']
})
if (!serp || serp.serpOnly !== false) {
  throw new Error(`inferSerpOnlyStructural should block SERP for gui mode: ${JSON.stringify(serp)}`)
}

const vision = sanitizeVisionAnswer('图像理解 图片中是一位女性，名为林婉清，坐在户外。', '请描述图片中的内容')
if (vision.includes('林婉清') || vision.includes('名为')) {
  throw new Error(`sanitizeVisionAnswer failed: ${vision}`)
}

const html = polishUserFacingAnswer('<strong class="md-strong">已提取百度搜索第一条结果。</strong>')
if (html.includes('<strong') || !html.includes('已提取')) {
  throw new Error(`polishUserFacingAnswer failed: ${html}`)
}

const badge = normalizeModelReplyHtml('需要&lt;span class="md-badge md-badge-warn"&gt;注意&lt;/span&gt;它们')
if (badge.includes('<span') || badge.includes('&lt;') || !badge.includes('注意')) {
  throw new Error(`normalizeModelReplyHtml failed: ${badge}`)
}

console.log('smoke-gui-vision-ui-fixes ok')
