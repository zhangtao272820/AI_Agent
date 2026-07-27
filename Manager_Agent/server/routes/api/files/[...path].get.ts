import { proxyBinaryMedia } from '../../_mediaProxy'
import { buildMusicFileUpstream } from '../../../utils/media/mediaProxyUrls'

/** 音乐/音频文件由 Music_Agent 提供（/api/files/{name}） */
export default defineEventHandler(async (event) => {
  const path = getRouterParam(event, 'path')
  if (!path) {
    throw createError({ statusCode: 404, statusMessage: 'file not found' })
  }
  return proxyBinaryMedia(event, buildMusicFileUpstream(path))
})
