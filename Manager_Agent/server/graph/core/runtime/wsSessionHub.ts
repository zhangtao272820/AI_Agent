export type WsOutbound = {
  event: string
  data?: unknown
  from?: string
  runId?: string
}

type PeerRecord = {
  send: (payload: WsOutbound) => void
  sessionIds: Set<string>
}

const peers = new Map<string, PeerRecord>()
const sessionToPeers = new Map<string, Set<string>>()

function linkSession(peerId: string, sessionId: string) {
  const sid = String(sessionId || '').trim()
  if (!sid) return
  const rec = peers.get(peerId)
  if (!rec) return
  rec.sessionIds.add(sid)
  if (!sessionToPeers.has(sid)) sessionToPeers.set(sid, new Set())
  sessionToPeers.get(sid)!.add(peerId)
}

function unlinkPeer(peerId: string) {
  const rec = peers.get(peerId)
  if (!rec) return
  for (const sid of rec.sessionIds) {
    const set = sessionToPeers.get(sid)
    if (set) {
      set.delete(peerId)
      if (!set.size) sessionToPeers.delete(sid)
    }
  }
  peers.delete(peerId)
}

/** 绑定 WebSocket peer 的发送函数；返回 unregister */
export function registerWsSessionPeer(
  peerId: string,
  sessionId: string,
  send: (payload: WsOutbound) => void
): () => void {
  const pid = String(peerId || '').trim() || `peer_${Date.now()}`
  let rec = peers.get(pid)
  if (!rec) {
    rec = { send, sessionIds: new Set() }
    peers.set(pid, rec)
  } else {
    rec.send = send
  }
  linkSession(pid, sessionId)
  return () => unlinkPeer(pid)
}

export function touchWsSessionPeer(peerId: string, sessionId: string) {
  linkSession(String(peerId || '').trim(), sessionId)
}

export function unregisterWsSessionPeer(peerId: string) {
  unlinkPeer(String(peerId || '').trim())
}

export function isSessionWsOnline(sessionId: string): boolean {
  const sid = String(sessionId || '').trim()
  if (!sid) return false
  const set = sessionToPeers.get(sid)
  return Boolean(set && set.size > 0)
}

export function broadcastToSession(sessionId: string, payload: WsOutbound): number {
  const sid = String(sessionId || '').trim()
  if (!sid) return 0
  const set = sessionToPeers.get(sid)
  if (!set?.size) return 0
  let n = 0
  for (const pid of set) {
    const rec = peers.get(pid)
    if (!rec) continue
    try {
      rec.send(payload)
      n += 1
    } catch {}
  }
  return n
}
