import { resolveAgentEndpoints } from '../utils/platform/agentEndpoints'
import { inferMediaTypeFromFilename } from '../utils/media/mediaAttachment'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig() as any
  const resolved = resolveAgentEndpoints(process.env)
  const base = String(
    resolved.multimodalAgentHttpUrl || config.agents?.multimodalAgentHttpUrl || ''
  ).replace(/\/+$/, '')
  if (!base) {
    throw createError({ statusCode: 503, statusMessage: 'multimodalAgentHttpUrl 未配置' })
  }

  const parts = await readMultipartFormData(event)
  const filePart = parts?.find((p) => p.name === 'file' && p.data?.length)
  if (!filePart?.data) {
    throw createError({ statusCode: 400, statusMessage: '缺少 file 字段' })
  }

  const maxBytes = 80 * 1024 * 1024
  if (filePart.data.length > maxBytes) {
    throw createError({ statusCode: 413, statusMessage: '文件过大（上限 80MB）' })
  }

  const filename = filePart.filename || 'upload.bin'
  const mediaTypeField = parts?.find((p) => p.name === 'media_type')?.data?.toString('utf8')?.trim()
  const mediaType = mediaTypeField || inferMediaTypeFromFilename(filename)

  const form = new FormData()
  const bytes = filePart.data instanceof Uint8Array ? filePart.data : new Uint8Array(filePart.data as ArrayBuffer)
  const blob = new Blob([bytes], { type: filePart.type || 'application/octet-stream' })
  form.append('file', blob, filename)
  form.append('media_type', mediaType)

  let res: Response
  try {
    res = await fetch(`${base}/api/multimodal/upload`, { method: 'POST', body: form })
  } catch (e: any) {
    throw createError({
      statusCode: 503,
      statusMessage: `无法连接多模态服务（${base}）：${String(e?.cause?.message || e?.message || e)}`
    })
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw createError({
      statusCode: res.status,
      statusMessage: String((data as any)?.detail || (data as any)?.error || res.statusText || '上传失败')
    })
  }

  return {
    ok: true,
    filePath: String((data as any)?.file_path || ''),
    mediaType: String((data as any)?.media_type || mediaType),
    filename: String((data as any)?.filename || filename)
  }
})
