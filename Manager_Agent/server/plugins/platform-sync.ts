import { getPlatformEndpointOverrides, isPlatformEndpointSyncEnabled } from '../utils/platform/agentPlatformSync'
import { getPlatformAgentConfig, isPlatformConfigSyncEnabled } from '../utils/platform/platformConfigRuntime'

export default defineNitroPlugin(async () => {
  if (isPlatformEndpointSyncEnabled()) {
    try {
      await getPlatformEndpointOverrides()
    } catch (e) {
      console.warn('[platform-sync] endpoints warmup failed:', (e as Error)?.message || e)
    }
  }
  if (isPlatformConfigSyncEnabled()) {
    try {
      await getPlatformAgentConfig()
    } catch (e) {
      console.warn('[platform-sync] config warmup failed:', (e as Error)?.message || e)
    }
  }
})
