/** Docker Compose 服务名 ↔ 默认端口（与 Manage-platform_Agent/docker-compose.agents-lan.yml 一致） */
const DOCKER_SERVICE_BY_PORT: Record<string, string> = {
  '13101': 'db_agent',
  '13102': 'rag_agent',
  '13103': 'code_assistent_agent',
  '13104': 'extractor_agent',
  '13105': 'ai_admin_agent',
  '13106': 'manager_agent',
  '13107': 'multimodal_agent',
  '13108': 'lobster_agent',
  '13109': 'tavern_agent',
  '13110': 'music_agent',
  '13111': 'video_agent',
  '13112': 'ai_agent'
}

function isLoopbackHost(hostname: string) {
  const h = String(hostname || '').trim().toLowerCase()
  return h === 'localhost' || h === '127.0.0.1' || h === '::1'
}

import { isManagerDockerRuntime } from './managerEnvModes'

function shouldRewriteForDocker(env: NodeJS.ProcessEnv) {
  if (isManagerDockerRuntime(env)) return true
  // 在容器内运行时 hostname 通常不是 localhost
  const hn = String(env.HOSTNAME ?? '').trim()
  return /_agent$/i.test(hn) || hn === 'manager_agent'
}

/** 将 localhost / Docker 网桥 IP 改写为 Compose 服务名，避免容器内连接失败 */
export function resolveAgentUrl(raw: string | undefined, env: NodeJS.ProcessEnv = process.env): string {
  const url = String(raw ?? '').trim()
  if (!url || !shouldRewriteForDocker(env)) return url
  try {
    const u = new URL(url)
    const port = u.port || (u.protocol === 'wss:' || u.protocol === 'ws:' ? '80' : '80')
    const svcByPort = DOCKER_SERVICE_BY_PORT[port]
    if (isLoopbackHost(u.hostname) && svcByPort) {
      u.hostname = svcByPort
      return u.toString()
    }
    // Node 报错里的 172.x/10.x 多为 Docker DNS 解析结果，根因通常是目标容器尚未监听端口
    if (/^(172\.(1[6-9]|2[0-9]|3[0-1])\.|10\.|192\.168\.)/.test(u.hostname) && svcByPort) {
      u.hostname = svcByPort
      return u.toString()
    }
    return url
  } catch {
    return url
  }
}

/** ws://host:13104/_ws → http://host:13104 */
export function agentWsUrlToHttpOrigin(wsUrl: string): string {
  const raw = String(wsUrl || '').trim()
  if (!raw) return ''
  try {
    const u = new URL(raw.replace(/^ws/i, 'http'))
    return `${u.protocol}//${u.host}`
  } catch {
    return ''
  }
}

/** 爬虫 WS 候选地址（主配置失败时依次尝试） */
export function resolveCrawlerWsCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  const primary = resolveAgentUrl(env.CRAWLER_AGENT_WS_URL, env)
  const out: string[] = []
  const push = (u: string) => {
    const t = String(u || '').trim()
    if (t && !out.includes(t)) out.push(t)
  }
  push(primary)
  if (shouldRewriteForDocker(env)) {
    push('ws://extractor_agent:13104/_ws')
  } else {
    push('ws://localhost:13104/_ws')
    push('ws://127.0.0.1:13104/_ws')
  }
  const explicitHttp = String(env.CRAWLER_AGENT_HTTP_URL || '').trim()
  if (explicitHttp) {
    try {
      const u = new URL(explicitHttp.replace(/\/+$/, ''))
      push(`ws://${u.host}/_ws`)
    } catch {}
  }
  return out
}

export type ResolvedAgentEndpoints = {
  dbAgentWsUrl: string
  dbAgentHttpUrl: string
  ragAgentHttpUrl: string
  codeAgentWsUrl: string
  crawlerAgentWsUrl: string
  lobsterAgentWsUrl: string
  aiAdminAgentWsUrl: string
  multimodalAgentHttpUrl: string
  musicAgentWsUrl: string
  videoAgentWsUrl: string
  musicAgentHttpUrl: string
  videoAgentHttpUrl: string
}

export function resolveAgentEndpoints(env: NodeJS.ProcessEnv = process.env): ResolvedAgentEndpoints {
  return {
    dbAgentWsUrl: resolveAgentUrl(env.DB_AGENT_WS_URL, env),
    dbAgentHttpUrl: resolveAgentUrl(env.DB_AGENT_HTTP_URL, env),
    ragAgentHttpUrl: resolveAgentUrl(env.RAG_AGENT_HTTP_URL, env),
    codeAgentWsUrl: resolveAgentUrl(env.CODE_AGENT_WS_URL, env),
    crawlerAgentWsUrl: resolveAgentUrl(env.CRAWLER_AGENT_WS_URL, env),
    lobsterAgentWsUrl: resolveAgentUrl(env.LOBSTER_AGENT_WS_URL, env),
    aiAdminAgentWsUrl: resolveAgentUrl(env.AI_ADMIN_AGENT_WS_URL, env),
    multimodalAgentHttpUrl: resolveAgentUrl(env.MULTIMODAL_AGENT_HTTP_URL, env),
    musicAgentWsUrl: resolveAgentUrl(env.MUSIC_AGENT_WS_URL, env),
    videoAgentWsUrl: resolveAgentUrl(env.VIDEO_AGENT_WS_URL, env),
    musicAgentHttpUrl: resolveAgentUrl(env.MUSIC_AGENT_HTTP_URL, env),
    videoAgentHttpUrl: resolveAgentUrl(env.VIDEO_AGENT_HTTP_URL, env)
  }
}
