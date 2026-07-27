/**
 * Code Agent 学习闭环：查询信号、经验回放、文件路径偏好、反馈统计。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getCodeAgentEnv } from './code_agent_env'
import type { CodeQueryPath } from './code_metrics'
import {
  recallVectorExperienceHints,
  type EmbeddingClientConfig,
  indexExperienceVector,
} from './code_experience_vectors'
import { getCodePromptPatchesForStage } from './code_prompt_evolution'
import { formatCrossAgentProfileBlock, appendCodeCrossAgentFact } from './code_cross_agent_memory'
import type { PromptAbVariant } from './code_prompt_ab_router'

export type CodeTaskKind = CodeQueryPath

export type CodeLearningSignal = {
  ts: string
  question: string
  question_norm: string
  task_kind: CodeTaskKind
  ok: boolean
  score?: number
  hint_files?: string[]
  files_touched?: string[]
  validate_ok?: boolean
  tool_calls?: number
  from_manager?: boolean
  ms?: number
  reason?: string
  comment?: string
}

export type CodeExperienceEntry = {
  ts: string
  question_norm: string
  task_kind: CodeTaskKind
  hint: string
  hint_files?: string[]
}

export type CodeRoutePreferences = {
  taskKindStats: Record<string, { ok: number; fail: number }>
  fileBoosts: Record<string, number>
  filePenalties: Record<string, number>
  positiveQueries: string[]
  negativeQueries: string[]
  totalSignals: number
  positiveCount: number
  negativeCount: number
}

let cachedPrefs: { at: number; prefs: CodeRoutePreferences } | null = null
const CACHE_TTL_MS = 30_000

function dataDir() {
  const dir = join(process.cwd(), '.data')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function signalsFile() {
  return join(dataDir(), 'code-learning-signals.jsonl')
}

export function experienceFile() {
  return join(dataDir(), 'code-query-experience.jsonl')
}

export function preferencesFile() {
  return join(dataDir(), 'code-route-preferences.json')
}

export function normalizeQuestionKey(question: string): string {
  return String(question ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[，,。.;；:：!?？]/g, '')
    .slice(0, 120)
}

function readJsonlLines<T>(file: string, maxLines?: number): T[] {
  const cap = maxLines ?? getCodeAgentEnv().learningSignalsMaxRead
  if (!existsSync(file)) return []
  try {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean)
    const out: T[] = []
    for (const line of lines.slice(-cap)) {
      try {
        out.push(JSON.parse(line) as T)
      } catch {
        /* skip */
      }
    }
    return out
  } catch {
    return []
  }
}

function tokenOverlap(a: string, b: string): number {
  const ta = new Set(normalizeQuestionKey(a).match(/[\u4e00-\u9fff]{2,}|[a-z0-9_]{2,}/g) ?? [])
  const tb = new Set(normalizeQuestionKey(b).match(/[\u4e00-\u9fff]{2,}|[a-z0-9_]{2,}/g) ?? [])
  if (!ta.size || !tb.size) return 0
  let hit = 0
  for (const t of ta) if (tb.has(t)) hit++
  return hit / Math.max(ta.size, tb.size)
}

function buildExperienceHint(sig: CodeLearningSignal): string {
  const parts = [
    `路径=${sig.task_kind}`,
    sig.hint_files?.length ? `关注文件=${sig.hint_files.slice(0, 4).join(',')}` : '',
    sig.files_touched?.length ? `曾改=${sig.files_touched.slice(0, 3).join(',')}` : '',
    sig.validate_ok === true ? '校验通过' : '',
  ].filter(Boolean)
  return parts.join('；').slice(0, 220)
}

export function buildRoutePreferences(): CodeRoutePreferences {
  const signals = readJsonlLines<CodeLearningSignal>(signalsFile())
  const taskKindStats: CodeRoutePreferences['taskKindStats'] = {}
  const fileBoosts: Record<string, number> = {}
  const filePenalties: Record<string, number> = {}
  const positiveQueries: string[] = []
  const negativeQueries: string[] = []
  let positiveCount = 0
  let negativeCount = 0

  for (const sig of signals) {
    const kind = String(sig.task_kind || 'full')
    if (!taskKindStats[kind]) taskKindStats[kind] = { ok: 0, fail: 0 }
    if (sig.ok) taskKindStats[kind].ok += 1
    else taskKindStats[kind].fail += 1

    const score = Number(sig.score)
    if (score === 1) {
      positiveCount++
      if (sig.question) positiveQueries.push(sig.question.slice(0, 200))
      for (const f of [...(sig.hint_files || []), ...(sig.files_touched || [])]) {
        const p = String(f).trim()
        if (p) fileBoosts[p] = (fileBoosts[p] ?? 0) + 1
      }
    } else if (score === -1) {
      negativeCount++
      if (sig.question) negativeQueries.push(sig.question.slice(0, 200))
      for (const f of [...(sig.hint_files || []), ...(sig.files_touched || [])]) {
        const p = String(f).trim()
        if (p) filePenalties[p] = (filePenalties[p] ?? 0) + 1
      }
    }
  }

  const prefs: CodeRoutePreferences = {
    taskKindStats,
    fileBoosts,
    filePenalties,
    positiveQueries: positiveQueries.slice(-80),
    negativeQueries: negativeQueries.slice(-40),
    totalSignals: signals.length,
    positiveCount,
    negativeCount,
  }

  try {
    writeFileSync(
      preferencesFile(),
      JSON.stringify({ updatedAt: new Date().toISOString(), ...prefs }, null, 2),
      'utf8',
    )
  } catch {
    /* ignore */
  }
  return prefs
}

export function getRoutePreferences(force = false): CodeRoutePreferences {
  const now = Date.now()
  if (!force && cachedPrefs && now - cachedPrefs.at < CACHE_TTL_MS) return cachedPrefs.prefs
  const prefs = buildRoutePreferences()
  cachedPrefs = { at: now, prefs }
  return prefs
}

export function recordLearningSignal(
  sig: Omit<CodeLearningSignal, 'ts' | 'question_norm'> & { question: string },
) {
  if (!getCodeAgentEnv().enableLearningLoop) return
  const row: CodeLearningSignal = {
    ...sig,
    ts: new Date().toISOString(),
    question_norm: normalizeQuestionKey(sig.question),
  }
  try {
    appendFileSync(signalsFile(), `${JSON.stringify(row)}\n`, 'utf8')
    cachedPrefs = null
  } catch {
    /* ignore */
  }
}

export function recordQueryOutcome(input: {
  question: string
  task_kind: CodeTaskKind
  ok: boolean
  hint_files?: string[]
  files_touched?: string[]
  validate_ok?: boolean
  tool_calls?: number
  from_manager?: boolean
  ms?: number
  reason?: string
}) {
  if (!getCodeAgentEnv().enableLearningLoop) return
  const row: CodeLearningSignal = {
    question: input.question.slice(0, 500),
    question_norm: normalizeQuestionKey(input.question),
    task_kind: input.task_kind,
    ok: input.ok,
    hint_files: input.hint_files,
    files_touched: input.files_touched,
    validate_ok: input.validate_ok,
    tool_calls: input.tool_calls,
    from_manager: input.from_manager,
    ms: input.ms,
    reason: input.reason,
    ts: new Date().toISOString(),
  }
  try {
    appendFileSync(signalsFile(), `${JSON.stringify(row)}\n`, 'utf8')
    cachedPrefs = null
  } catch {
    /* ignore */
  }

  if (input.ok && input.question.length >= 6) {
    const hint = buildExperienceHint(row)
    if (hint) {
      const exp: CodeExperienceEntry = {
        ts: row.ts,
        question_norm: row.question_norm,
        task_kind: row.task_kind,
        hint,
        hint_files: input.hint_files || input.files_touched,
      }
      try {
        appendFileSync(experienceFile(), `${JSON.stringify(exp)}\n`, 'utf8')
      } catch {
        /* ignore */
      }
      appendCodeCrossAgentFact({
        fact: hint,
        intent: 'code_assistant',
        scenarioKey: input.task_kind,
        confidence: 0.78,
      })
    }
  }
}

export function recordFeedback(input: {
  question: string
  score: number
  comment?: string
  task_kind?: CodeTaskKind
  hint_files?: string[]
}) {
  recordLearningSignal({
    question: input.question,
    task_kind: input.task_kind || 'full',
    ok: input.score === 1,
    score: input.score,
    comment: input.comment,
    hint_files: input.hint_files,
  })
}

export function recallSimilarExperience(question: string, taskKind?: CodeTaskKind, max = 3): CodeExperienceEntry[] {
  const qn = normalizeQuestionKey(question)
  const rows = readJsonlLines<CodeExperienceEntry>(experienceFile(), 400)
  return rows
    .map((r) => {
      const sim = Math.max(
        tokenOverlap(question, r.question_norm || ''),
        tokenOverlap(question, r.hint || ''),
      )
      const normHit =
        Boolean(qn && r.question_norm) &&
        (r.question_norm === qn || r.question_norm.includes(qn) || qn.includes(r.question_norm))
      return {
        row: r,
        sim,
        normHit,
        kindMatch: !taskKind || r.task_kind === taskKind ? 1 : 0,
      }
    })
    .filter((x) => x.sim >= 0.32 || x.normHit)
    .sort((a, b) => b.kindMatch - a.kindMatch || b.sim - a.sim)
    .slice(0, max)
    .map((x) => x.row)
}

export function getFileScoreAdjust(path: string): number {
  const prefs = getRoutePreferences()
  const p = String(path ?? '').trim()
  if (!p) return 0
  let adj = 0
  for (const [name, boost] of Object.entries(prefs.fileBoosts)) {
    if (p.includes(name) || name.includes(p)) adj += Math.min(0.15, boost * 0.05)
  }
  for (const [name, pen] of Object.entries(prefs.filePenalties)) {
    if (p.includes(name) || name.includes(p)) adj -= Math.min(0.2, pen * 0.06)
  }
  return adj
}

export function buildExperienceContextBlock(question: string, taskKind?: CodeTaskKind): string {
  if (!getCodeAgentEnv().enableLearningLoop) return ''
  const prefs = getRoutePreferences()
  const similar = recallSimilarExperience(question, taskKind, 3)
  const lines: string[] = []

  const pos = prefs.positiveQueries
    .map((q) => ({ q, sim: tokenOverlap(question, q) }))
    .filter((r) => r.sim >= 0.35)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, 2)
  if (pos.length) {
    lines.push(`相似成功问句：${pos.map((r) => r.q.slice(0, 80)).join(' | ')}`)
  }

  if (similar.length) {
    lines.push(
      '历史成功路径：',
      ...similar.map((s) => `- ${s.hint}${s.hint_files?.length ? `（${s.hint_files.slice(0, 3).join(', ')}）` : ''}`),
    )
  }

  const boosted = Object.entries(prefs.fileBoosts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([k]) => k)
  if (boosted.length && (taskKind === 'inspect' || taskKind === 'edit' || taskKind === 'full')) {
    lines.push(`用户常关注文件：${boosted.join(', ')}`)
  }

  if (!lines.length) return ''
  return `[经验回放]（仅供参考；与当前问句不一致时必须忽略，以当前问句为准）\n${lines.join('\n')}`.slice(0, 520)
}

export function getLearningSummary() {
  const prefs = getRoutePreferences(true)
  const okRate =
    prefs.positiveCount + prefs.negativeCount > 0
      ? prefs.positiveCount / (prefs.positiveCount + prefs.negativeCount)
      : null
  return {
    total: prefs.totalSignals,
    positive: prefs.positiveCount,
    negative: prefs.negativeCount,
    okRate,
    taskKindStats: prefs.taskKindStats,
    boostedFiles: Object.keys(prefs.fileBoosts).slice(0, 10),
    penalizedFiles: Object.keys(prefs.filePenalties).slice(0, 8),
  }
}

export function clearLearningData() {
  try {
    writeFileSync(signalsFile(), '', 'utf8')
    writeFileSync(experienceFile(), '', 'utf8')
    cachedPrefs = null
  } catch {
    /* ignore */
  }
}

export function clearRoutePreferences() {
  try {
    writeFileSync(preferencesFile(), JSON.stringify({ updatedAt: new Date().toISOString() }, null, 2), 'utf8')
    cachedPrefs = null
  } catch {
    /* ignore */
  }
}

export async function buildFullExperienceContext(input: {
  question: string
  task_kind?: CodeTaskKind
  embeddingConfig?: EmbeddingClientConfig
  sessionKey?: string
  abVariant?: PromptAbVariant
}): Promise<string> {
  const blocks: string[] = []
  const cross = formatCrossAgentProfileBlock(input.sessionKey, input.question)
  if (cross) blocks.push(cross)

  const base = buildExperienceContextBlock(input.question, input.task_kind)
  if (base) blocks.push(base)

  if (input.embeddingConfig && getCodeAgentEnv().enableVectorExperience) {
    try {
      const hits = await recallVectorExperienceHints({
        question: input.question,
        task_kind: input.task_kind,
        embeddingConfig: input.embeddingConfig,
        max: 2,
      })
      if (hits.length) {
        blocks.push(
          '语义相似经验：',
          ...hits.map((h) => `- ${h.hint}${h.hint_files?.length ? `（${h.hint_files.slice(0, 2).join(', ')}）` : ''}`),
        )
      }
    } catch {
      /* 向量召回失败不阻断 */
    }
  }

  const stage = input.task_kind === 'compute' ? 'compute' : 'agent'
  const patches = getCodePromptPatchesForStage(stage, 2, input.abVariant ?? 'treatment')
  if (patches) blocks.push(patches)

  return blocks.join('\n').slice(0, 900)
}

export async function indexSuccessfulQuery(input: {
  question: string
  task_kind: CodeTaskKind
  hint_files?: string[]
  files_touched?: string[]
  validate_ok?: boolean
  embeddingConfig?: EmbeddingClientConfig
}) {
  if (!getCodeAgentEnv().enableLearningLoop) return
  const hint = [
    `路径=${input.task_kind}`,
    input.hint_files?.length ? `文件=${input.hint_files.slice(0, 4).join(',')}` : '',
    input.files_touched?.length ? `改动=${input.files_touched.slice(0, 3).join(',')}` : '',
    input.validate_ok ? '校验通过' : '',
  ]
    .filter(Boolean)
    .join('；')
  if (input.embeddingConfig) {
    await indexExperienceVector({
      question: input.question,
      hint,
      task_kind: input.task_kind,
      hint_files: input.hint_files || input.files_touched,
      embeddingConfig: input.embeddingConfig,
    }).catch(() => {})
  }
}
