import { deriveScenarioKey } from '../text'
import {
  blendRecallScore,
  cosineSimilarity,
  embedQuery,
  embedTexts,
  isVectorMemoryEnabled,
  vectorScoresForUsers
} from '../memory/vectorMemory'
import type { IntentClassifyResult } from '../../llm/intentClassifyLlm'
import { MANAGER_INTENT_PLAYBOOK, type IntentPlaybookEntry } from '../memory/intentPlaybook'
import type { IntentRecallHit, IntentRagRecallResult } from './intentRagRecallCore'
import { isIntentRagRecallEnabled } from './intentRagRecallCore'
import { anchorBoostForRecall, type SessionIntentAnchor } from '../memory/multiTurnIntent'
import {
  demoteRecallHitForUser,
  pickTopRecallHitForUser,
  recallHitHasCapabilityDrift
} from '../memory/userIntentSupremacy'
import {
  intentRagExperienceDomainFactor,
  resolveManagerIntentRagDomain,
} from './intentRagDomain'
import { findPromptHygieneViolations } from '#agent-shared/promptHygiene'
import {
  clipIntentRagHint,
  intentRagPromptTopK,
} from '#agent-shared/costFlashPolicy'

export type { IntentRecallHit, IntentRagRecallResult } from './intentRagRecallCore'
export {
  alignIntentClassifyWithRecall,
  intentRecallHitToClassify,
  intentRagRecallFromMeta,
  isIntentRagFastPathEnabled,
  isIntentRagRecallEnabled,
  shouldUseIntentRagFastPath
} from './intentRagRecallCore'

function recallTopK(): number {
  return intentRagPromptTopK()
}

function minLexicalScore(): number {
  const n = Number(process.env.MANAGER_INTENT_RAG_MIN_LEXICAL ?? 0.12)
  return Number.isFinite(n) && n >= 0.05 && n <= 0.45 ? n : 0.12
}

function tokenBag(text: string): Set<string> {
  const s = String(text || '').toLowerCase()
  const parts = s.match(/[\p{L}\p{N}_]{2,}/gu) || []
  return new Set(parts.slice(0, 140))
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const x of a) {
    if (b.has(x)) inter += 1
  }
  const union = a.size + b.size - inter
  return union ? inter / union : 0
}

type PlaybookVectorRow = { entryId: string; paraphrase: string; embedding: number[] }

let playbookVectorCache: PlaybookVectorRow[] | null = null
let playbookVectorKey = ''

async function loadPlaybookVectors(): Promise<PlaybookVectorRow[]> {
  const domain = resolveManagerIntentRagDomain()
  const key = `${domain}|${MANAGER_INTENT_PLAYBOOK.length}|${process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-v1'}`
  if (playbookVectorCache && playbookVectorKey === key) return playbookVectorCache
  if (!isVectorMemoryEnabled()) {
    playbookVectorCache = []
    playbookVectorKey = key
    return []
  }
  const texts: string[] = []
  const meta: Array<{ entryId: string; paraphrase: string }> = []
  for (const e of MANAGER_INTENT_PLAYBOOK) {
    for (const p of e.paraphrases) {
      const t = String(p || '').trim()
      if (t.length < 4) continue
      texts.push(t)
      meta.push({ entryId: e.id, paraphrase: t })
    }
  }
  const vectors = await embedTexts(texts).catch(() => [])
  const rows: PlaybookVectorRow[] = []
  for (let i = 0; i < meta.length; i++) {
    const emb = vectors[i]
    if (!emb?.length) continue
    rows.push({ entryId: meta[i]!.entryId, paraphrase: meta[i]!.paraphrase, embedding: emb })
  }
  playbookVectorCache = rows
  playbookVectorKey = key
  return rows
}

function playbookHitFromEntry(entry: IntentPlaybookEntry, score: number, matchedText: string): IntentRecallHit {
  return {
    id: entry.id,
    score,
    source: 'playbook',
    matchedText,
    primaryIntent: entry.primaryIntent,
    isMulti: entry.isMulti,
    suggestedAgents: [...entry.suggestedAgents],
    isDbAnchored: entry.isDbAnchored,
    needsAdmin: entry.needsAdmin,
    needsWeb: entry.needsWeb,
    explicitWantsReport: entry.explicitWantsReport,
    explicitWantsVisualize: entry.explicitWantsVisualize,
    planShortcut: entry.planShortcut,
    explanation: entry.note
  }
}

async function scorePlaybookEntries(
  query: string,
  qBag: Set<string>,
  qEmb?: number[] | null
): Promise<IntentRecallHit[]> {
  const byId = new Map<string, { score: number; matchedText: string }>()
  const useVector = isVectorMemoryEnabled()
  const queryVec = useVector
    ? qEmb?.length
      ? qEmb
      : await embedQuery(query).catch(() => null)
    : null
  const rows = queryVec?.length ? await loadPlaybookVectors() : []

  if (queryVec?.length && rows.length) {
    for (const row of rows) {
      const sim = cosineSimilarity(queryVec, row.embedding)
      const entry = MANAGER_INTENT_PLAYBOOK.find((e) => e.id === row.entryId)
      if (!entry) continue
      const jac = jaccard(qBag, tokenBag(row.paraphrase))
      const score = blendRecallScore(sim, jac, 0, 0)
      const prev = byId.get(entry.id)
      if (!prev || score > prev.score) {
        byId.set(entry.id, { score, matchedText: row.paraphrase })
      }
    }
  }

  for (const entry of MANAGER_INTENT_PLAYBOOK) {
    let bestJac = 0
    let bestPhrase = entry.paraphrases[0] || entry.id
    for (const p of entry.paraphrases) {
      const jac = jaccard(qBag, tokenBag(p))
      if (jac > bestJac) {
        bestJac = jac
        bestPhrase = p
      }
    }
    const prev = byId.get(entry.id)
    const lexScore = bestJac
    if (!prev && lexScore >= minLexicalScore()) {
      byId.set(entry.id, { score: 0.35 * lexScore + 0.12, matchedText: bestPhrase })
    } else if (prev && lexScore > 0) {
      const blended = blendRecallScore(prev.score, lexScore, 0, 0)
      if (blended > prev.score) byId.set(entry.id, { score: blended, matchedText: bestPhrase })
    }
  }

  const hits: IntentRecallHit[] = []
  for (const entry of MANAGER_INTENT_PLAYBOOK) {
    const row = byId.get(entry.id)
    if (!row || row.score < minLexicalScore()) continue
    hits.push(playbookHitFromEntry(entry, row.score, row.matchedText))
  }
  return hits
}

function experienceToPlanShortcut(intent: string, path: string[]): IntentRecallHit['planShortcut'] {
  const agents = new Set(path.map((a) => String(a || '').trim()).filter(Boolean))
  if (agents.size === 1 && agents.has('db')) return 'db_only'
  if (agents.size === 1 && agents.has('rag')) return 'rag_only'
  if (agents.size === 1 && agents.has('admin')) return 'admin_only'
  if (agents.has('db') && agents.has('visualize') && agents.size <= 3) return 'db_chart'
  if (String(intent).trim() === 'db') return 'db_only'
  if (String(intent).trim() === 'rag') return 'rag_only'
  if (String(intent).trim() === 'admin') return 'admin_only'
  return 'none'
}

async function scoreExperienceEntries(
  policyDir: string,
  query: string,
  qBag: Set<string>,
  scenarioKey: string,
  qEmb?: number[] | null
): Promise<IntentRecallHit[]> {
  const { readManagerExperienceHistory } = await import('../runtime/runtimePersistence')
  const history = await readManagerExperienceHistory(policyDir, 400)
  const activeDomain = resolveManagerIntentRagDomain()
  const users: string[] = []
  for (const h of history) {
    if (h?.type !== 'experience') continue
    const domainFactor = intentRagExperienceDomainFactor(
      (h as { dataDomain?: string }).dataDomain,
      activeDomain,
    )
    if (domainFactor <= 0) continue
    const user = String(h.user || '').trim()
    if (user.length >= 6) users.push(user)
  }
  const vectorSims = isVectorMemoryEnabled()
    ? await vectorScoresForUsers(policyDir, query, users, qEmb).catch(() => new Map<string, number>())
    : new Map<string, number>()

  const hits: IntentRecallHit[] = []
  for (const h of history) {
    if (h?.type !== 'experience') continue
    const user = String(h.user || '').trim()
    if (user.length < 6) continue
    const domainFactor = intentRagExperienceDomainFactor(
      (h as { dataDomain?: string }).dataDomain,
      activeDomain,
    )
    if (domainFactor <= 0) continue
    if (findPromptHygieneViolations(user).length) continue
    const succ =
      typeof h.successScore === 'number' && Number.isFinite(h.successScore)
        ? Math.max(0, Math.min(1, h.successScore))
        : 0.55
    if (succ < 0.48) continue

    const jac = jaccard(qBag, tokenBag(user))
    const vecSim = vectorSims.get(user) ?? 0
    const hScenario =
      typeof h.scenarioKey === 'string' && h.scenarioKey.trim() ? String(h.scenarioKey).trim() : deriveScenarioKey(user)
    const sceneMatch = scenarioKey && hScenario === scenarioKey ? 1 : 0
    if (jac < minLexicalScore() && vecSim < 0.4) continue

    const path = Array.isArray(h.path) ? h.path.map((x: unknown) => String(x ?? '').trim()).filter(Boolean) : []
    const intent = String(h.intent || 'multi').trim()
    let score = blendRecallScore(vecSim, jac, sceneMatch, 0.15 * succ) * domainFactor
    if (recallHitHasCapabilityDrift(
      {
        id: '',
        score,
        source: 'experience',
        matchedText: user,
        primaryIntent: 'multi',
        isMulti: true,
        suggestedAgents: path as IntentRecallHit['suggestedAgents'],
        isDbAnchored: path.includes('db'),
        needsAdmin: path.includes('admin'),
        needsWeb: path.includes('crawler'),
        explicitWantsReport: path.includes('report'),
        explicitWantsVisualize: path.includes('visualize'),
        planShortcut: experienceToPlanShortcut(intent, path),
        explanation: ''
      },
      query
    )) {
      score *= 0.35
    }
    hits.push({
      id: `exp:${user.slice(0, 24)}`,
      score,
      source: 'experience',
      matchedText: user.slice(0, 160),
      primaryIntent: (['db', 'rag', 'multi', 'admin', 'crawler', 'gui', 'multimodal', 'music', 'video'].includes(intent)
        ? intent
        : 'multi') as IntentRecallHit['primaryIntent'],
      isMulti: intent === 'multi' || path.length >= 2,
      suggestedAgents: path as IntentRecallHit['suggestedAgents'],
      isDbAnchored: path.includes('db') || intent === 'db',
      needsAdmin: path.includes('admin') || intent === 'admin',
      needsWeb: path.includes('crawler') || path.includes('gui'),
      explicitWantsReport: false,
      explicitWantsVisualize: path.includes('visualize'),
      planShortcut: experienceToPlanShortcut(intent, path),
      explanation: `历史成功路径 ${path.join('→') || intent}；质量≈${succ.toFixed(2)}`
    })
  }
  return hits
}

function probeBoost(hit: IntentRecallHit, probe?: { db?: { matched?: boolean }; rag?: { hits?: number } } | null): number {
  let boost = 0
  if (hit.isDbAnchored && probe?.db?.matched) boost += 0.06
  if (hit.primaryIntent === 'rag' && Number(probe?.rag?.hits ?? 0) > 0) boost += 0.05
  if (hit.planShortcut === 'db_only' && !probe?.db?.matched) boost -= 0.08
  return boost
}

/** Stage-3：意图 RAG 预召回（Playbook 泛化样例 + 历史成功经验，向量+lexical 混合）。 */
export async function buildIntentRagRecall(input: {
  policyDir: string
  queryText: string
  probe?: { db?: { matched?: boolean; tables?: string[] }; rag?: { hits?: number } } | null
  sessionAnchor?: SessionIntentAnchor | null
  multiTurn?: boolean
}): Promise<IntentRagRecallResult> {
  const empty: IntentRagRecallResult = {
    items: [],
    text: '',
    count: 0,
    vectorRecall: false,
    topHit: null,
    scenarioKey: ''
  }
  if (!isIntentRagRecallEnabled()) return empty

  const q = String(input.queryText || '').replace(/\s+/g, ' ').trim()
  if (q.length < 6) return { ...empty, scenarioKey: deriveScenarioKey(q) }

  const scenarioKey = deriveScenarioKey(q)
  const qBag = tokenBag(q)
  const useVector = isVectorMemoryEnabled()
  const qEmb = useVector ? await embedQuery(q).catch(() => null) : null

  const [playbookHits, experienceHits] = await Promise.all([
    scorePlaybookEntries(q, qBag, qEmb),
    scoreExperienceEntries(input.policyDir, q, qBag, scenarioKey, qEmb)
  ])

  const merged = [...playbookHits, ...experienceHits]
    .map((h) => demoteRecallHitForUser({
      ...h,
      score: h.score + probeBoost(h, input.probe) + anchorBoostForRecall(h, input.sessionAnchor)
    }, q))
    .sort((a, b) => b.score - a.score)

  const seen = new Set<string>()
  const items: IntentRecallHit[] = []
  for (const h of merged) {
    const dedupe = `${h.source}:${h.id}`
    if (seen.has(dedupe)) continue
    seen.add(dedupe)
    items.push(h)
    if (items.length >= recallTopK()) break
  }

  const userQuery = String(input.queryText || '').trim()
  const topHit = pickTopRecallHitForUser(items, userQuery)
  const recallLabel = useVector ? '向量+lexical' : 'lexical'
  const multiLabel = input.multiTurn ? '多轮扩展' : '单轮'
  const text = items.length
        ? [
        `### 意图 RAG 召回（${recallLabel}/${multiLabel}；相似历史仅作参考，**以本轮用户原话为准**，不得扩写未要求的 report/图表/办公步骤）`,
        ...items.slice(0, recallTopK()).map(
          (h, i) =>
            `${i + 1}. [${h.source}] score=${h.score.toFixed(2)} intent=${h.primaryIntent}${h.isMulti ? '/multi' : ''} agents=${JSON.stringify(h.suggestedAgents)} shortcut=${h.planShortcut}；匹配「${clipIntentRagHint(h.matchedText)}」；${clipIntentRagHint(h.explanation, 80)}`
        )
      ].join('\n')
    : ''

  return {
    items,
    text,
    count: items.length,
    vectorRecall: useVector,
    topHit,
    scenarioKey
  }
}

export function formatIntentRagRecallBlock(result: IntentRagRecallResult): string {
  return String(result.text || '').trim()
}
