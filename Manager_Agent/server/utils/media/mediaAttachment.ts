import { z } from 'zod'

export const MediaAttachmentSchema = z.object({
  filePath: z.string().min(1).max(512),
  mediaType: z.enum(['image', 'video', 'audio']),
  filename: z.string().max(256).optional()
})

export type MediaAttachment = z.infer<typeof MediaAttachmentSchema>

export function inferMediaTypeFromMime(mime: string): 'image' | 'video' | 'audio' {
  const m = String(mime || '').toLowerCase()
  if (m.startsWith('video/')) return 'video'
  if (m.startsWith('audio/')) return 'audio'
  return 'image'
}

export function inferMediaTypeFromFilename(name: string): 'image' | 'video' | 'audio' {
  const n = String(name || '').toLowerCase()
  if (/\.(mp4|webm|mov|avi|mkv|m4v)$/.test(n)) return 'video'
  if (/\.(mp3|wav|m4a|ogg|flac|aac|webm)$/.test(n)) return 'audio'
  return 'image'
}

export function parseMediaAttachment(raw: unknown): MediaAttachment | undefined {
  const parsed = MediaAttachmentSchema.safeParse(raw)
  return parsed.success ? parsed.data : undefined
}

export type ExecutableAgent =
  | 'db'
  | 'rag'
  | 'code'
  | 'crawler'
  | 'gui'
  | 'admin'
  | 'clean'
  | 'visualize'
  | 'report'
  | 'multimodal'
  | 'music'
  | 'video'

const EXECUTABLE: ExecutableAgent[] = [
  'db',
  'rag',
  'code',
  'crawler',
  'gui',
  'admin',
  'clean',
  'visualize',
  'report',
  'multimodal',
  'music',
  'video'
]

/** 路由 allowedAgents：以路由模型 JSON 为准；健康/平台问题在执行阶段处理，不在路由阶段剔除 */
export function resolveRouteAllowedAgents(params: {
  intent: string
  llmAllowed: ExecutableAgent[]
  toolHealth?: { agents?: Array<{ agent: string; status: string }> } | null
  taskText?: string
}): ExecutableAgent[] {
  const { intent, llmAllowed } = params

  if (intent === 'multimodal' || intent === 'music' || intent === 'video') {
    return [intent]
  }

  if (intent !== 'multi') {
    if (llmAllowed.length) return llmAllowed
    return EXECUTABLE.includes(intent as ExecutableAgent) ? [intent as ExecutableAgent] : []
  }

  return llmAllowed.length >= 1 ? llmAllowed : []
}
