/**
 * 记忆与进化 Ops 聚合（PG 计数 + 可选外部 learning 摘要）
 */

import { agentPgQuery, isAgentPgConfigured, pingAgentPg } from './agentPgClient'

export type MemoryPgStats = {
  pgReachable: boolean
  sessions: number
  sessionTurns: number
  memoryEntries: Record<string, number>
  embeddings: number
  evoPolicies: number
  semanticFacts: number
  toolMemoryRows: number
  skillDrafts: number
  foldedSessions: number
  dbExperienceRows: number
  ragLearningSignals: number
  adminToolExperience: number
  codeExperienceRows: number
  crawlerExperienceRows: number
  guiExperienceRows: number
  mcpRegistryRows: number
}

export async function queryMemoryPgStats(env: NodeJS.ProcessEnv = process.env): Promise<MemoryPgStats> {
  const empty: MemoryPgStats = {
    pgReachable: false,
    sessions: 0,
    sessionTurns: 0,
    memoryEntries: {},
    embeddings: 0,
    evoPolicies: 0,
    semanticFacts: 0,
    toolMemoryRows: 0,
    skillDrafts: 0,
    foldedSessions: 0,
    dbExperienceRows: 0,
    ragLearningSignals: 0,
    adminToolExperience: 0,
    codeExperienceRows: 0,
    crawlerExperienceRows: 0,
    guiExperienceRows: 0,
    mcpRegistryRows: 0
  }
  if (!isAgentPgConfigured()) return empty
  const pgReachable = await pingAgentPg(env)
  if (!pgReachable) return { ...empty, pgReachable: false }

  const [sessions, turns, entries, embeddings, policies, semantic, toolMem, skillDrafts, folded, dbExp, ragSig, admExp, codeExp, crawlExp, guiExp, mcpReg] =
    await Promise.all([
    agentPgQuery<{ n: string }>(`SELECT COUNT(*)::text AS n FROM mgr_sessions`, [], env),
    agentPgQuery<{ n: string }>(`SELECT COUNT(*)::text AS n FROM mgr_session_turns`, [], env),
    agentPgQuery<{ entry_type: string; n: string }>(
      `SELECT entry_type, COUNT(*)::text AS n FROM mgr_memory_entries GROUP BY entry_type`,
      [],
      env
    ),
    agentPgQuery<{ n: string }>(`SELECT COUNT(*)::text AS n FROM mgr_memory_embeddings`, [], env),
    agentPgQuery<{ n: string }>(`SELECT COUNT(*)::text AS n FROM evo_policy_versions`, [], env),
    agentPgQuery<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM mgr_memory_entries WHERE entry_type = 'semantic'`,
      [],
      env
    ),
    agentPgQuery<{ n: string }>(`SELECT COUNT(*)::text AS n FROM mgr_tool_memory`, [], env).catch(() => null),
    agentPgQuery<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM mgr_skill_drafts WHERE status = 'draft'`,
      [],
      env
    ).catch(() => null),
    agentPgQuery<{ n: string }>(`SELECT COUNT(*)::text AS n FROM mgr_session_fold_state`, [], env).catch(() => null),
    agentPgQuery<{ n: string }>(`SELECT COUNT(*)::text AS n FROM db_query_experience`, [], env).catch(() => null),
    agentPgQuery<{ n: string }>(`SELECT COUNT(*)::text AS n FROM rag_learning_signals`, [], env).catch(() => null),
    agentPgQuery<{ n: string }>(`SELECT COUNT(*)::text AS n FROM adm_tool_experience`, [], env).catch(() => null),
    agentPgQuery<{ n: string }>(`SELECT COUNT(*)::text AS n FROM code_query_experience`, [], env).catch(() => null),
    agentPgQuery<{ n: string }>(`SELECT COUNT(*)::text AS n FROM ext_crawl_experience`, [], env).catch(() => null),
    agentPgQuery<{ n: string }>(`SELECT COUNT(*)::text AS n FROM lob_gui_experience`, [], env).catch(() => null),
    agentPgQuery<{ n: string }>(`SELECT COUNT(*)::text AS n FROM mgr_mcp_tool_registry WHERE enabled = TRUE`, [], env).catch(() => null)
  ])

  const memoryEntries: Record<string, number> = {}
  for (const row of entries?.rows ?? []) {
    memoryEntries[row.entry_type] = Number(row.n) || 0
  }

  return {
    pgReachable: true,
    sessions: Number(sessions?.rows?.[0]?.n) || 0,
    sessionTurns: Number(turns?.rows?.[0]?.n) || 0,
    memoryEntries,
    embeddings: Number(embeddings?.rows?.[0]?.n) || 0,
    evoPolicies: Number(policies?.rows?.[0]?.n) || 0,
    semanticFacts: Number(semantic?.rows?.[0]?.n) || 0,
    toolMemoryRows: Number(toolMem?.rows?.[0]?.n) || 0,
    skillDrafts: Number(skillDrafts?.rows?.[0]?.n) || 0,
    foldedSessions: Number(folded?.rows?.[0]?.n) || 0,
    dbExperienceRows: Number(dbExp?.rows?.[0]?.n) || 0,
    ragLearningSignals: Number(ragSig?.rows?.[0]?.n) || 0,
    adminToolExperience: Number(admExp?.rows?.[0]?.n) || 0,
    codeExperienceRows: Number(codeExp?.rows?.[0]?.n) || 0,
    crawlerExperienceRows: Number(crawlExp?.rows?.[0]?.n) || 0,
    guiExperienceRows: Number(guiExp?.rows?.[0]?.n) || 0,
    mcpRegistryRows: Number(mcpReg?.rows?.[0]?.n) || 0
  }
}
