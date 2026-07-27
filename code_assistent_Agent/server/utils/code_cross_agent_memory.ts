/**
 * P4 跨 Agent 记忆：读取总管 semantic + DB/RAG 偏好，成功时回写 bridge / 总管 semantic。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getCodeAgentEnv } from './code_agent_env'
import { normalizeUserKey, formatUserPreferencesBlock } from './code_user_preferences'

type DbUserPreferences = {
  preferred_data_domain?: string
  frequent_names?: string[]
  frequent_metrics?: string[]
  default_time_relative?: string
}

type RagRoutePrefs = {
  boostedSources?: string[]
  positiveQueries?: string[]
}

type SemanticRow = {
  ts?: string
  scenarioKey?: string
  intent?: string
  fact?: string
  confidence?: number
}

function tokenBag(text: string): Set<string> {
  const parts = String(text || '').toLowerCase().match(/[\u4e00-\u9fff]{2,}|[a-z0-9_]{2,}/g) ?? []
  return new Set(parts.slice(0, 80))
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter += 1
  return inter / (a.size + b.size - inter)
}

function sharedDataDir(): string | null {
  const custom = String(process.env.AGENT_SHARED_DATA_DIR ?? '').trim()
  if (custom) return custom
  const mgr = join(process.cwd(), '..', 'Manager_Agent', '.data')
  if (existsSync(mgr)) return mgr
  return null
}

function managerPolicyDir(): string | null {
  const env = String(process.env.CODE_MANAGER_POLICY_DIR ?? '').trim()
  if (env && existsSync(env)) return env
  const shared = sharedDataDir()
  if (shared) return shared
  return null
}

function dbPrefsPath(): string | null {
  const custom = sharedDataDir()
  if (custom) {
    const p = join(custom, 'db-user-preferences.json')
    if (existsSync(p)) return p
  }
  const sibling = join(process.cwd(), '..', 'DB_Agent', '.data', 'db-user-preferences.json')
  if (existsSync(sibling)) return sibling
  return null
}

function ragPrefsPath(): string | null {
  const custom = sharedDataDir()
  if (custom) {
    const p = join(custom, 'rag-route-preferences.json')
    if (existsSync(p)) return p
  }
  const sibling = join(process.cwd(), '..', 'RAG_Agent', '.data', 'rag-route-preferences.json')
  if (existsSync(sibling)) return sibling
  return null
}

function bridgeFile() {
  const dir = join(process.cwd(), '.data')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'code-memory-bridge.jsonl')
}

function readJsonlTail(file: string, maxLines: number): SemanticRow[] {
  if (!existsSync(file)) return []
  try {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).slice(-maxLines)
    const out: SemanticRow[] = []
    for (const line of lines) {
      try {
        out.push(JSON.parse(line) as SemanticRow)
      } catch {
        /* skip */
      }
    }
    return out
  } catch {
    return []
  }
}

function loadDbPrefs(userKey?: string): DbUserPreferences | null {
  const p = dbPrefsPath()
  if (!p) return null
  try {
    const store = JSON.parse(readFileSync(p, 'utf8')) as Record<string, DbUserPreferences>
    const key = normalizeUserKey(userKey)
    return store[key] ?? store.__global__ ?? null
  } catch {
    return null
  }
}

function loadRagPrefs(): RagRoutePrefs | null {
  const p = ragPrefsPath()
  if (!p) return null
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as RagRoutePrefs
  } catch {
    return null
  }
}

export function recallManagerSemanticHints(question: string, max = 4): string[] {
  const env = getCodeAgentEnv()
  if (!env.enableCrossAgentMemory) return []
  const policyDir = managerPolicyDir()
  if (!policyDir) return []
  const file = join(policyDir, 'manager-memory-semantic.jsonl')
  const qBag = tokenBag(question)
  const rows = readJsonlTail(file, 120)
  return rows
    .map((r) => {
      const fact = String(r?.fact ?? '').trim()
      const intent = String(r?.intent ?? '').toLowerCase()
      const codeRelated =
        intent.includes('code') ||
        /代码|改仓|inspect|compute|repo|文件|bug|refactor|test/i.test(fact)
      const jac = jaccard(qBag, tokenBag(fact))
      const conf = typeof r?.confidence === 'number' ? r.confidence * 0.1 : 0.05
      return { fact, score: (codeRelated ? jac + 0.12 : jac * 0.6) + conf }
    })
    .filter((x) => x.fact.length >= 10 && x.score >= 0.1)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((x) => x.fact)
}

export function formatCrossAgentProfileBlock(userKey?: string, question?: string): string {
  const env = getCodeAgentEnv()
  if (!env.enableCrossAgentMemory) return ''
  const lines: string[] = []

  const userBlock = formatUserPreferencesBlock(userKey)
  if (userBlock) lines.push(userBlock)

  const db = loadDbPrefs(userKey)
  if (db) {
    if (db.preferred_data_domain && db.preferred_data_domain !== 'general') {
      lines.push(`- DB 常查数据域：${db.preferred_data_domain}`)
    }
    if (db.frequent_names?.length) lines.push(`- DB 常查对象：${db.frequent_names.slice(0, 4).join('、')}`)
    if (db.frequent_metrics?.length) lines.push(`- DB 常关注指标：${db.frequent_metrics.slice(0, 4).join('、')}`)
    if (db.default_time_relative) lines.push(`- DB 常用时间：${db.default_time_relative}`)
  }

  const rag = loadRagPrefs()
  if (rag?.boostedSources?.length) {
    lines.push(`- RAG 常命中文档：${rag.boostedSources.slice(0, 3).join('、')}`)
  }
  if (rag?.positiveQueries?.length) {
    lines.push(`- RAG 相似成功问法：${rag.positiveQueries.slice(0, 2).join(' | ')}`)
  }

  if (question) {
    const semantic = recallManagerSemanticHints(question, 3)
    if (semantic.length) {
      lines.push('- 总管语义记忆：')
      for (const s of semantic) lines.push(`  - ${s.slice(0, 140)}`)
    }
  }

  if (!lines.length) return ''
  return `[跨 Agent 画像]\n${lines.join('\n')}`
}

export function appendCodeCrossAgentFact(input: {
  fact: string
  sessionId?: string
  scenarioKey?: string
  intent?: string
  confidence?: number
}) {
  const env = getCodeAgentEnv()
  if (!env.enableCrossAgentMemory) return
  const fact = String(input.fact ?? '').trim().slice(0, 160)
  if (fact.length < 12) return

  const row = {
    ts: new Date().toISOString(),
    intent: input.intent || 'code_assistant',
    scenarioKey: input.scenarioKey || 'code',
    fact,
    confidence: Math.min(0.95, input.confidence ?? 0.75),
    sessionId: input.sessionId,
  }

  try {
    appendFileSync(bridgeFile(), `${JSON.stringify(row)}\n`, 'utf8')
  } catch {
    /* ignore */
  }

  const policyDir = managerPolicyDir()
  if (!policyDir || !env.enableCrossAgentWriteBack) return
  try {
    const target = join(policyDir, 'manager-memory-semantic.jsonl')
    appendFileSync(target, `${JSON.stringify(row)}\n`, 'utf8')
  } catch {
    /* ignore */
  }
}

export function getCrossAgentMemorySummary() {
  const env = getCodeAgentEnv()
  let bridgeLines = 0
  const bf = bridgeFile()
  if (existsSync(bf)) {
    try {
      bridgeLines = readFileSync(bf, 'utf8').split(/\r?\n/).filter(Boolean).length
    } catch {
      bridgeLines = 0
    }
  }
  return {
    enabled: env.enableCrossAgentMemory,
    writeBack: env.enableCrossAgentWriteBack,
    managerPolicyDir: managerPolicyDir(),
    dbPrefsPath: dbPrefsPath(),
    ragPrefsPath: ragPrefsPath(),
    bridgeLines,
  }
}

export function clearCrossAgentBridge() {
  try {
    writeFileSync(bridgeFile(), '', 'utf8')
  } catch {
    /* ignore */
  }
}
