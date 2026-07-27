/**
 * 任务相关侦察摘要：从 probe 结果提炼供 planner 消费的 reconNotes（确定性组装，非关键词路由）。
 */

export type ReconNotesInput = {
  rag?: { hits?: number; topSources?: unknown[]; error?: string }
  db?: {
    matched?: boolean
    tables?: string[]
    businessTables?: string[]
    routingRelevant?: boolean
    ragInfraOnly?: boolean
    error?: string
  }
  crawler?: { probed?: boolean; ready?: boolean; healthy?: boolean }
  gui?: { probed?: boolean; ready?: boolean; healthy?: boolean }
  code?: { probed?: boolean; healthy?: boolean }
}

export function buildReconNotesFromProbe(probe: ReconNotesInput | null | undefined): string {
  if (!probe || typeof probe !== 'object') return ''
  const lines: string[] = ['【侦察摘要 reconNotes】']
  const ragHits = Number(probe.rag?.hits || 0)
  if (ragHits > 0) {
    const sources = Array.isArray(probe.rag?.topSources)
      ? probe.rag!.topSources!.slice(0, 3).map((x) => String(x ?? '').trim()).filter(Boolean)
      : []
    lines.push(`- 知识库：命中 ${ragHits} 条${sources.length ? `（${sources.join('；')}）` : ''}`)
  } else if (probe.rag?.error) {
    lines.push(`- 知识库：探测失败（${String(probe.rag.error).slice(0, 80)}）`)
  } else {
    lines.push('- 知识库：暂无命中')
  }

  if (probe.db?.error) {
    lines.push(`- 数据库：探测失败（${String(probe.db.error).slice(0, 80)}）`)
  } else if (probe.db?.ragInfraOnly) {
    lines.push('- 数据库：仅命中基建表，业务库未对齐')
  } else if (probe.db?.routingRelevant || probe.db?.matched) {
    const tables = (probe.db.businessTables?.length ? probe.db.businessTables : probe.db.tables || [])
      .map((t) => String(t || '').trim())
      .filter(Boolean)
      .slice(0, 4)
    lines.push(`- 数据库：可用${tables.length ? `（${tables.join(', ')}）` : ''}`)
  } else {
    lines.push('- 数据库：未匹配业务表')
  }

  if (probe.crawler?.probed) {
    lines.push(
      `- 爬虫：${probe.crawler.ready ? '就绪' : probe.crawler.healthy ? '仅健康检查通过' : '不可用'}`
    )
  }
  if (probe.gui?.probed) {
    lines.push(`- GUI：${probe.gui.ready ? '就绪' : probe.gui.healthy ? '仅健康检查通过' : '不可用'}`)
  }
  if (probe.code?.probed) {
    lines.push(`- Code：${probe.code.healthy ? '就绪' : '不可用'}`)
  }

  lines.push('规划时优先消费以上证据，避免空想步骤。')
  return lines.join('\n')
}

export function formatReconNotesBlock(notes: unknown): string {
  const text = String(notes || '').trim()
  if (!text) return ''
  if (text.includes('【侦察摘要')) return text
  return `【侦察摘要 reconNotes】\n${text}`
}
