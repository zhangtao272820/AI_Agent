import { looksLikeSynthRejectingMedia } from '#agent-shared/textMarkers'

/** 拼装最终展示文本时，子 Agent 结果的优先级 */
export const RESULT_AGENT_ORDER = [
  'multimodal',
  'music',
  'video',
  'report',
  'visualize',
  'clean',
  'rag',
  'db',
  'crawler',
  'code',
  'admin'
] as const

export function pickPrimaryResultText(results: Record<string, unknown> | null | undefined): string {
  const bag = results && typeof results === 'object' ? results : {}
  for (const key of RESULT_AGENT_ORDER) {
    const v = String((bag as any)[key] ?? '').trim()
    if (v) return v
  }
  return ''
}

/** synth 误报「缺图/无附件」但 multimodal 已有实质输出 */
export function isSynthRejectingMedia(synth: string, multimodalOut: string): boolean {
  return looksLikeSynthRejectingMedia(synth, multimodalOut)
}

export function isMediaOnlyPlanAgents(agents: string[]): boolean {
  if (!agents.length) return false
  const media = new Set(['multimodal', 'music', 'video'])
  return agents.every((a) => media.has(String(a || '')))
}

const MEDIA_AGENT_ORDER = ['multimodal', 'music', 'video'] as const
export type MediaAgentKey = (typeof MEDIA_AGENT_ORDER)[number]

export function mediaAgentsInPlan(agents: string[]): MediaAgentKey[] {
  const set = new Set(agents.map((a) => String(a || '').trim()))
  return MEDIA_AGENT_ORDER.filter((k) => set.has(k))
}

/** 单步 music/video/multimodal 时 plan 可能为空，用 intent 推断媒体 plan */
export function inferMediaPlanAgents(intent: string, planAgents: string[]): MediaAgentKey[] {
  const fromPlan = mediaAgentsInPlan(planAgents)
  if (fromPlan.length) return fromPlan
  const i = String(intent || '').trim() as MediaAgentKey
  return MEDIA_AGENT_ORDER.includes(i) ? [i] : []
}

export function textHasPlayableMediaUrl(text: string): boolean {
  return /(?:https?:\/\/|\/api\/(?:video|files)\/)[^\s)\]>"']+\.(?:mid|midi|mp3|wav|m4a|ogg|mp4|webm)/i.test(
    String(text ?? '')
  )
}

/** 复合媒体任务：按步骤顺序拼接各子 Agent 原文（保留 MIDI/视频路径供前端播放器解析） */
export function buildCompositeMediaFinal(
  results: Record<string, unknown> | null | undefined,
  planAgents?: string[]
): string {
  const bag = results && typeof results === 'object' ? results : {}
  const planned = planAgents?.length ? mediaAgentsInPlan(planAgents) : []
  const order: MediaAgentKey[] =
    planned.length > 0
      ? planned
      : MEDIA_AGENT_ORDER.filter((k) => String((bag as any)[k] ?? '').trim().length > 0)
  const labels: Record<MediaAgentKey, string> = {
    multimodal: '图像理解',
    music: '音乐生成',
    video: '视频生成'
  }
  const sections: string[] = []
  for (const agent of order) {
    const raw = String((bag as any)[agent] ?? '').trim()
    if (!raw) continue
    sections.push(`### ${labels[agent]}\n\n${raw}`)
  }
  return sections.join('\n\n')
}
