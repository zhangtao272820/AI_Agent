export type CreateProbeNodeDeps = {
  opts: {
    sendEvent: (event: { event: string; data?: any; from?: string }) => void
    ragAgentHttpUrl: string
    dbAgentHttpUrl: string
    crawlerAgentWsUrl?: string
    lobsterAgentWsUrl?: string
    codeAgentWsUrl?: string
    dbId?: string
  }
  lastUserText: (messages: any[]) => string
  fetchJson: (url: string, payload: any, timeoutMs: number) => Promise<any>
}
