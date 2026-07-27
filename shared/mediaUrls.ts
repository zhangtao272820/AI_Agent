/** 将子 Agent 返回的媒体 URL 规范为总管同源代理路径，供浏览器播放/下载。 */

export function stripTrailingPunctuation(url: string): string {
  return String(url || '').trim().replace(/[),.;`'"\]]+$/g, '')
}

export function normalizeVideoProxySegment(path: string): string {
  const p = String(path || '').replace(/^\/+/, '')
  return p.startsWith('out/') ? p.slice(4) : p
}

function isAgentLocalMediaPath(pathKey: string): boolean {
  return pathKey.includes('api/video/out') || pathKey.includes('api/files')
}

/** 外链音视频经总管同源代理，避免浏览器 fetch 跨域导致无法下载/播放 */
export function toRemoteMediaProxyUrl(rawUrl: string): string {
  const url = stripTrailingPunctuation(rawUrl)
  if (!url || !/^https?:\/\//i.test(url)) return url
  return `/api/media/remote?url=${encodeURIComponent(url)}`
}

export function toManagerProxyMediaUrl(rawUrl: string, kind: 'video' | 'audio' | 'file'): string {
  const url = stripTrailingPunctuation(rawUrl)
  if (!url) return ''
  if (/^\/api\/video\/out\//i.test(url)) {
    const name = decodeURIComponent(url.split('/').pop() || '')
    return name ? `/api/video/${encodeURIComponent(name)}` : url
  }
  if (/^\/api\/(?:video|files)\//i.test(url)) return url
  if (!/^https?:\/\//i.test(url)) return url
  try {
    const u = new URL(url)
    const segments = u.pathname.split('/').filter(Boolean)
    const name = decodeURIComponent(segments.pop() || '')
    if (!name) return url
    const pathKey = segments.join('/').toLowerCase()
    // 仅改写 Video/Music Agent 本机路径；万相/CDN 外链走 remote 代理，勿误映射为 /api/video/{文件名}
    if (isAgentLocalMediaPath(pathKey)) {
      if (pathKey.includes('api/video')) return `/api/video/${encodeURIComponent(name)}`
      return `/api/files/${encodeURIComponent(name)}`
    }
    return toRemoteMediaProxyUrl(url)
  } catch {
    return url
  }
}

export function resolveClientMediaUrl(raw: string): string {
  const s = stripTrailingPunctuation(raw)
  if (!s) return ''
  if (/^\/api\/media\/remote\?/i.test(s)) return s
  if (/^\/api\/video\/out\//i.test(s)) return toManagerProxyMediaUrl(s, 'video')
  if (/^\/api\/(?:video|files)\//i.test(s)) return s
  if (/^https?:\/\//i.test(s)) {
    const kind =
      /\.(mp4|webm|mov|mkv|m4v)(\?|#|$)/i.test(s) || /\/api\/video\//i.test(s) ? 'video' : 'audio'
    return toManagerProxyMediaUrl(s, kind)
  }
  if (s.startsWith('/')) return s
  return s
}
