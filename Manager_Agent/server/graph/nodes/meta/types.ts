
export type CreateMetacogNodeDeps = {
  opts: { sendEvent: (event: { event: string; data?: any; from?: string }) => void }
  lastUserText: (messages: any[]) => string
  isCapabilityOutOfScope: (text: string) => { out: boolean; reason?: string }
  mergeMeta: (state: any, patch: Record<string, any>) => Record<string, any>
}

export type CreateClarifyNodeDeps = {
  opts: { sendEvent: (event: { event: string; data?: any; from?: string }) => void }
  lastUserText: (messages: any[]) => string
  mergeMeta: (state: any, patch: Record<string, any>) => Record<string, any>
  appendMemory: (entry: { user: string } & Record<string, any>) => Promise<void>
}

