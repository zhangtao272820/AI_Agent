/**
 * Manager WebSocket URL 与鉴权 payload 组装
 */
export function buildManagerWsUrl(managerWsToken: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const base = `${protocol}//${window.location.host}/api/manager-ws`
  const tok = String(managerWsToken || '').trim()
  return tok ? `${base}?token=${encodeURIComponent(tok)}` : base
}

export function withManagerWsAuth(
  payload: Record<string, unknown>,
  managerWsToken: string
): Record<string, unknown> {
  const tok = String(managerWsToken || '').trim()
  return tok ? { ...payload, wsToken: tok } : payload
}
