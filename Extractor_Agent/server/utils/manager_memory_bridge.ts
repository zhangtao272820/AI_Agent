/**
 * P6 可选：向总管上报 semantic facts（写入 result.meta.memory_facts）。
 */
import { getExtractorAgentEnv } from './extractor_agent_env'

function clipText(s: string, max: number) {
  const t = String(s ?? '').trim()
  return t.length > max ? t.slice(0, max) : t
}

export function buildExtractorMemoryFacts(input: {
  task: string
  target_site?: string
  content_type?: string
  channel?: string
  item_count?: number
  seed_url?: string
  fields?: string[]
}): string[] {
  if (!getExtractorAgentEnv().enableManagerMemoryBridge) return []
  const facts: string[] = []
  const site = String(input.target_site ?? '').trim()
  const type = String(input.content_type ?? '').trim()
  const count = Number(input.item_count ?? 0)
  const channel = String(input.channel ?? '').trim()
  const seed = String(input.seed_url ?? '').trim()

  if (site && site !== 'generic') {
    facts.push(
      clipText(
        `近期成功从 ${site} 抓取${type && type !== 'generic' ? type : '列表数据'}${count > 0 ? `（${count} 条）` : ''}`,
        100,
      ),
    )
  }
  if (seed && /^https?:\/\//i.test(seed)) {
    facts.push(clipText(`有效种子 URL：${seed}`, 120))
  }
  if (channel && channel !== 'unknown') {
    facts.push(clipText(`${site || '该站点'} 优选通道：${channel}`, 80))
  }
  if (input.fields?.length) {
    facts.push(clipText(`常取字段：${input.fields.slice(0, 6).join('、')}`, 100))
  }
  return facts.filter(Boolean).slice(0, 4)
}
