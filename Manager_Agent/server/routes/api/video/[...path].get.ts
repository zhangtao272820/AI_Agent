import { proxyBinaryMedia } from '../../_mediaProxy'
import { buildVideoFileUpstream } from '../../../utils/media/mediaProxyUrls'

/** 视频文件由 Video_Agent 提供（/api/video/out/{name}） */
export default defineEventHandler(async (event) => {
  const path = getRouterParam(event, 'path')
  if (!path) {
    throw createError({ statusCode: 404, statusMessage: 'file not found' })
  }
  return proxyBinaryMedia(event, buildVideoFileUpstream(path))
})
