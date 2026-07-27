export type CreateToolHealthNodeDeps = {
  opts: {
    sendEvent: (event: { event: string; data?: any; from?: string }) => void
    dbAgentHttpUrl: string
    dbAgentWsUrl: string
    ragAgentHttpUrl: string
    codeAgentWsUrl: string
    crawlerAgentWsUrl: string
    aiAdminAgentWsUrl: string
    multimodalAgentHttpUrl: string
    musicAgentHttpUrl: string
    videoAgentHttpUrl: string
  }
  policyDir: string
  safeJsonParse: (text: string) => any
  percentile: (arr: number[], p: number) => number
}
