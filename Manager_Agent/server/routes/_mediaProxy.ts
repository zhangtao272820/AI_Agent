import { type H3Event, getHeader } from 'h3'

export async function proxyBinaryMedia(event: H3Event, target: string) {
  const range = getHeader(event, 'range')
  const headers: Record<string, string> = {}
  if (range) headers.range = range

  let upstream: Response
  try {
    upstream = await fetch(target, {
      headers,
      redirect: 'follow'
    })
  } catch (e: any) {
    throw createError({
      statusCode: 502,
      statusMessage: `media upstream unreachable: ${String(e?.message || e)}`
    })
  }

  const responseHeaders = new Headers()
  const passThrough = [
    'content-type',
    'content-length',
    'accept-ranges',
    'content-disposition',
    'cache-control',
    'etag',
    'last-modified',
    'content-range'
  ]
  for (const key of passThrough) {
    const value = upstream.headers.get(key)
    if (value) responseHeaders.set(key, value)
  }
  responseHeaders.set('cache-control', responseHeaders.get('cache-control') || 'no-store')

  // 确保浏览器把音视频当作可在线播放资源处理，而不是被下载器/代理误判为附件。
  if (!responseHeaders.has('content-disposition')) {
    responseHeaders.set('content-disposition', 'inline')
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders
  })
}
