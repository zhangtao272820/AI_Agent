import { applyWebExecutionModeToRoute } from '../../../server/utils/search/managerWebExecutionModeLlm'
import { agentsForWebExecutionHeuristic } from '../../../server/utils/gui/managerGuiAgentAvailability'
import { shouldRouteToWebSearch } from '../../../server/utils/search/managerWebSearch'

process.env.LOBSTER_AGENT_WS_URL = 'ws://localhost:13108/_ws'

const allowed = agentsForWebExecutionHeuristic(['crawler'], { agents: [{ agent: 'gui', status: 'healthy' }] })
if (!allowed.includes('gui')) {
  throw new Error(`gui should be in heuristic allowed: ${allowed.join(',')}`)
}

const guiMode = {
  mode: 'gui' as const,
  primaryAgent: 'gui' as const,
  needsWebSearch: false,
  serpSummaryEnough: false,
  confidence: 0.9,
  rationale: 'browser'
}
const routed = applyWebExecutionModeToRoute({
  intent: 'crawler',
  allowedAgents: ['crawler'],
  llmNeedsWebSearch: true,
  mode: guiMode
})
if (routed.intent !== 'gui' || routed.llmNeedsWebSearch !== false || !routed.allowedAgents.includes('gui')) {
  throw new Error(`gui route apply failed: ${JSON.stringify(routed)}`)
}

if (
  shouldRouteToWebSearch({
    intent: 'gui',
    meta: { needsWebSearch: true, webExecutionMode: guiMode, allowedAgents: ['gui'] }
  })
) {
  throw new Error('shouldRouteToWebSearch must block gui mode')
}

console.log('smoke-gui-route-whitelist ok')
