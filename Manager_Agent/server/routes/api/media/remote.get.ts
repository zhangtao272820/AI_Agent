import { getQuery } from 'h3'
import { proxyBinaryMedia } from '../../_mediaProxy'

const ALLOWED_REMOTE =
  /\.(mp4|webm|mov|mkv|m4v|mp3|wav|m4a|ogg|flac|aac|mid|midi)(\?|#|$)/i

/** 外链音视频同源代理（万相 CDN 等），供总管 UI 播放/下载 */
export default defineEventHandler(async (event) => {
  const raw = getQuery(event).url
  const url = String(Array.isArray(raw) ? raw[0] : raw || '').trim()
  if (!url || !/^https?:\/\//i.test(url)) {
    throw createError({ statusCode: 400, statusMessage: 'url required' })
  }
  if (!ALLOWED_REMOTE.test(url)) {
    throw createError({ statusCode: 400, statusMessage: 'unsupported media url' })
  }
  return proxyBinaryMedia(event, url)
})
