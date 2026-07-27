import { normalizeVideoProxySegment } from '#agent-shared/mediaUrls'
import { agentWsUrlToHttpOrigin, resolveAgentUrl } from '../platform/agentEndpoints'

function httpBaseFromEnv(httpKey: string, wsKey: string, fallback: string): string {
  const explicit = resolveAgentUrl(process.env[httpKey]).replace(/\/$/, '')
  if (explicit) return explicit
  const fromWs = agentWsUrlToHttpOrigin(resolveAgentUrl(process.env[wsKey]))
  return (fromWs || fallback).replace(/\/$/, '')
}

export function musicAgentHttpBase(): string {
  return httpBaseFromEnv('MUSIC_AGENT_HTTP_URL', 'MUSIC_AGENT_WS_URL', 'http://127.0.0.1:13110')
}

export function videoAgentHttpBase(): string {
  return httpBaseFromEnv('VIDEO_AGENT_HTTP_URL', 'VIDEO_AGENT_WS_URL', 'http://127.0.0.1:13111')
}

export function buildMusicFileUpstream(path: string): string {
  const safe = encodeURI(String(path || '').replace(/^\/+/, ''))
  return `${musicAgentHttpBase()}/api/files/${safe}`
}

export function buildVideoFileUpstream(path: string): string {
  const segment = normalizeVideoProxySegment(path)
  const safe = encodeURI(segment)
  return `${videoAgentHttpBase()}/api/video/out/${safe}`
}
