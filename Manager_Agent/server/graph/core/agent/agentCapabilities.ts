/** 将 probe / 注册表信息整理为路由与 planner 可读的「子 Agent 能力快照」 */

export type AgentCapabilitySnapshot = {
  db?: { matched: boolean; tables: string[]; error?: string }
  rag?: { hits: number; hasDocs: boolean; sources: string[] }
  updatedAt: string
}

export function buildCapabilitySnapshotFromProbe(probe: any): AgentCapabilitySnapshot {
  const p = probe || {}
  return {
    updatedAt: new Date().toISOString(),
    db: {
      matched: Boolean(p?.db?.matched),
      tables: Array.isArray(p?.db?.tables) ? p.db.tables.map((t: any) => String(t)).filter(Boolean).slice(0, 8) : [],
      error: p?.db?.error ? String(p.db.error) : undefined
    },
    rag: {
      hits: Number(p?.rag?.hits ?? 0) || 0,
      hasDocs: Boolean(p?.rag?.hasDocs),
      sources: Array.isArray(p?.rag?.sources) ? p.rag.sources.map((s: any) => String(s)).filter(Boolean).slice(0, 6) : []
    }
  }
}

export function formatCapabilityProbeBlock(snapshot: AgentCapabilitySnapshot | null): string {
  if (!snapshot) return ''
  const lines: string[] = ['### 子 Agent 能力探测（规划前对齐，弱参考）']
  if (snapshot.db) {
    lines.push(
      `- db：${snapshot.db.matched ? `已匹配表 ${snapshot.db.tables.join('、') || '(有)'}` : '未匹配表'}${snapshot.db.error ? `；${snapshot.db.error}` : ''}`
    )
  }
  if (snapshot.rag) {
    lines.push(
      `- rag：${snapshot.rag.hits > 0 ? `命中 ${snapshot.rag.hits} 条` : '未命中'}；hasDocs=${snapshot.rag.hasDocs ? '是' : '否'}`
    )
  }
  if (snapshot.db?.matched && snapshot.rag.hits === 0) {
    lines.push('- 建议：结构化查数优先 db，勿在无 rag 命中时硬加 rag 步骤')
  }
  if (!snapshot.db?.matched && snapshot.rag.hits > 0) {
    lines.push('- 建议：文档类任务优先 rag，勿在无表匹配时硬加 db 步骤')
  }
  return lines.length > 1 ? lines.join('\n') : ''
}
