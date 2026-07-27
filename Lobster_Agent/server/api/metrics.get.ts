import { getLobsterRuntimeMetrics } from '../services/lobsterRuntime'
import { ensureInternalAgentAccess } from '../utils/internal_auth'

export default defineEventHandler((event) => {
  ensureInternalAgentAccess(event)
  return getLobsterRuntimeMetrics()
})
