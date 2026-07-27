import { z } from 'zod'
import { safeJsonParse, parseFirstBalancedJsonObject } from '../core/shared/llmJson'
import type { TaskClause } from '../core/routing/clauses'
import type { TaskConstraints } from '../core/plan'
import type { IntentRagRecallResult } from '../core/rag/intentRagRecallCore'
import { formatAgentBoundaryPrompt } from '../orchestrate/unifiedRouting'
import { resolveManagerEnvBool } from '../../utils/platform/managerEnvModes'

export const PLAN_SHORTCUT_KINDS = ['none', 'db_chart', 'db_only', 'rag_only', 'admin_only', 'chitchat_only'] as const
export type PlanShortcutKind = (typeof PLAN_SHORTCUT_KINDS)[number]

export type PlanShortcutCoerceHint = {
  dataSources?: string[]
  isMulti?: boolean
  needsWeb?: boolean
  explicitWantsVisualize?: boolean
  explicitWantsReport?: boolean
  suggestedAgents?: string[]
}

/** LLM 常发明 rag_crawler 等非法值 → 映射到合法 shortcut */
export function coercePlanShortcut(v: unknown, hint?: PlanShortcutCoerceHint): PlanShortcutKind {
  const x = String(v ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s+]+/g, '_')
  if ((PLAN_SHORTCUT_KINDS as readonly string[]).includes(x)) {
    return x as PlanShortcutKind
  }
  if (/rag/.test(x) && /crawl|web/.test(x)) return 'none'
  if (/db/.test(x) && /chart|viz|visual/.test(x)) return 'db_chart'
  if (/db/.test(x)) return 'db_only'
  if (/rag/.test(x)) return 'rag_only'
  if (/admin/.test(x)) return 'admin_only'
  if (/chat/.test(x)) return 'chitchat_only'

  const ds = hint?.dataSources ?? []
  const agents = hint?.suggestedAgents ?? []
  const hasRag = ds.includes('rag') || agents.includes('rag')
  const hasCrawler = ds.includes('crawler') || agents.includes('crawler') || hint?.needsWeb === true
  if (hint?.isMulti || ds.length >= 2 || (hasRag && hasCrawler)) return 'none'
  if (hint?.explicitWantsVisualize || hint?.explicitWantsReport) return 'none'
  return 'none'
}

export function coerceBool(v: unknown, fallback = false): boolean {
  if (typeof v === 'boolean') return v
  const s = String(v ?? '')
    .trim()
    .toLowerCase()
  if (s === 'true' || s === '1' || s === 'yes') return true
  if (s === 'false' || s === '0' || s === 'no') return false
  return fallback
}

export function normalizeIntentClassifyPayload(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw
  const o = { ...(raw as Record<string, unknown>) }
  const ds = Array.isArray(o.dataSources)
    ? (o.dataSources as unknown[]).map((d) => String(d)).filter((d) => ['rag', 'db', 'crawler'].includes(d))
    : []
  o.dataSources = ds
  o.isMulti = coerceBool(o.isMulti, ds.length >= 2)
  o.isDbAnchored = coerceBool(o.isDbAnchored, false)
  o.needsAdmin = coerceBool(o.needsAdmin, false)
  o.needsWeb = coerceBool(o.needsWeb, ds.includes('crawler'))
  o.explicitWantsReport = coerceBool(o.explicitWantsReport, false)
  o.explicitWantsVisualize = coerceBool(o.explicitWantsVisualize, false)
  o.requiresAgentPipeline = coerceBool(o.requiresAgentPipeline, ds.length >= 2 || coerceBool(o.isMulti, false))
  o.allowChatWebDirect = coerceBool(o.allowChatWebDirect, !o.requiresAgentPipeline)
  o.planShortcut = coercePlanShortcut(o.planShortcut, {
    dataSources: ds,
    isMulti: o.isMulti as boolean,
    needsWeb: o.needsWeb as boolean,
    explicitWantsVisualize: o.explicitWantsVisualize as boolean,
    explicitWantsReport: o.explicitWantsReport as boolean,
    suggestedAgents: Array.isArray(o.suggestedAgents) ? (o.suggestedAgents as unknown[]).map(String) : []
  })
  if (typeof o.confidence !== 'number') {
    const n = Number(o.confidence)
    o.confidence = Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.65
  }
  const suggested = Array.isArray(o.suggestedAgents)
    ? (o.suggestedAgents as unknown[]).map((a) => String(a)).filter(Boolean)
    : []
  o.suggestedAgents = suggested
  if (!suggested.includes('admin')) {
    o.needsAdmin = false
    o.suggestedAgents = suggested.filter((a) => a !== 'admin')
  }
  const pi = String(o.primaryIntent ?? '').trim()
  if (!(ROUTE_INTENTS as readonly string[]).includes(pi)) {
    o.primaryIntent = coerceBool(o.isMulti, ds.length >= 2) ? 'multi' : ds.includes('rag') ? 'rag' : ds.includes('db') ? 'db' : 'multi'
  }
  return o
}

const ROUTE_INTENTS = [
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
  'video',
  'multi'
] as const

export const IntentClassifySchema = z.object({
  primaryIntent: z.enum(ROUTE_INTENTS),
  isMulti: z.boolean(),
  suggestedAgents: z
    .array(
      z.enum([
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
      ])
    )
    .max(8)
    .default([]),
  isDbAnchored: z.boolean(),
  needsAdmin: z.boolean(),
  needsWeb: z.boolean(),
  explicitWantsReport: z.boolean(),
  explicitWantsVisualize: z.boolean(),
  planShortcut: z.enum(PLAN_SHORTCUT_KINDS),
  /** 用户本轮显式需要的数据面（语义判断，勿与 probe 混淆） */
  dataSources: z
    .array(z.enum(['rag', 'db', 'crawler']))
    .max(3)
    .default([]),
  /** true：必须走 planner/multi 全流水线，禁止聊天式联网直答 */
  requiresAgentPipeline: z.boolean().default(false),
  /** false：即使 SERP 够也须 crawler/子 Agent 取数 */
  allowChatWebDirect: z.boolean().default(true),
  confidence: z.number().min(0).max(1),
  rationale: z.string().max(480).default('')
})

export type IntentClassifyResult = z.infer<typeof IntentClassifySchema>

export function isIntentClassifyEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveManagerEnvBool('MANAGER_INTENT_CLASSIFY', env)
}

export function intentClassifyFromMeta(meta: unknown): IntentClassifyResult | null {
  const raw = (meta as { intentClassify?: unknown } | null)?.intentClassify
  const parsed = IntentClassifySchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

/** 纯函数 smoke / 单测注入意图识别结果 */
export function mockIntentClassifyForTest(partial: Partial<IntentClassifyResult> = {}): IntentClassifyResult {
  return {
    primaryIntent: 'db',
    isMulti: false,
    suggestedAgents: ['db'],
    isDbAnchored: true,
    needsAdmin: false,
    needsWeb: false,
    explicitWantsReport: false,
    explicitWantsVisualize: false,
    planShortcut: 'db_only',
    dataSources: ['db'],
    requiresAgentPipeline: false,
    allowChatWebDirect: true,
    confidence: 0.9,
    rationale: 'test',
    ...partial
  }
}

function formatClauses(clauses: TaskClause[]): string {
  if (!clauses.length) return '（无）'
  return clauses
    .map((c, i) => {
      const agents = c.agents?.length ? ` [${c.agents.join('+')}]` : ''
      return `${i + 1}. ${c.text.trim()}${agents}`
    })
    .join('\n')
}

function formatConstraints(c: TaskConstraints | null | undefined): string {
  if (!c) return '（无）'
  return JSON.stringify({
    timeHints: c.timeHints,
    subjectHints: c.subjectHints,
    fieldHints: c.fieldHints,
    wantsVisualize: c.wantsVisualize,
    wantsReport: c.wantsReport
  })
}

function formatProbe(probe?: { db?: { matched?: boolean; tables?: string[] }; rag?: { hits?: number } } | null): string {
  const db = probe?.db?.matched
    ? `DB 命中表: ${(probe.db.tables || []).join(',') || '?'}（仅本轮末句探测，勿因上轮库表命中而判 isDbAnchored）`
    : 'DB 未命中'
  const ragHits = Number(probe?.rag?.hits ?? 0)
  const rag = ragHits > 0 ? `RAG 命中 ${ragHits} 条` : 'RAG 未命中'
  return `${db}; ${rag}`
}

/**
 * P1 意图识别专用节点：只做意图/数据面/快捷路径预判，不替代 Router 的最终 JSON。
 * 与 taskConstraints（槽位）和 decompose（子句）解耦，供 Router / Planner 作强先验。
 */
export async function classifyUserIntentByLlm(input: {
  userText: string
  heuristicsText?: string
  clauses?: TaskClause[]
  constraints?: TaskConstraints | null
  probe?: { db?: { matched?: boolean; tables?: string[] }; rag?: { hits?: number } } | null
  ragRecall?: IntentRagRecallResult | null
  llmInvoke: LlmInvokeFn
  state: unknown
}): Promise<IntentClassifyResult | null> {
  if (!isIntentClassifyEnabled()) return null
  const userText = String(input.userText || '').trim()
  if (!userText || userText.length < 4) return null

  const heuristics = String(input.heuristicsText || userText).trim().slice(0, 2200)
  const clauses = Array.isArray(input.clauses) ? input.clauses : []
  const ragBlock = String(input.ragRecall?.text || '').trim()

  try {
    const r = await input.llmInvoke(
      'route',
      input.state,
      [
        [
          'system',
          [
            '你是总管 Agent 的「意图识别节点」（legacy 路径；统一模式下不执行）。',
            formatAgentBoundaryPrompt(),
            '仅依据【用户末轮】判断 dataSources 与 suggestedAgents；召回/Probe 仅供参考。',
            'planShortcut 仅允许：none|db_chart|db_only|rag_only|admin_only|chitchat_only。',
            '只输出 JSON，无 markdown。'
          ].join('\n')
        ],
        [
          'human',
          [
            `【用户末轮】\n${userText.slice(0, 1200)}`,
            `【路由启发式句】\n${heuristics}`,
            `【子句拆解】\n${formatClauses(clauses)}`,
            `【槽位约束（参考）】\n${formatConstraints(input.constraints)}`,
            `【Probe】\n${formatProbe(input.probe)}`,
            ragBlock ? `【意图 RAG 召回】\n${ragBlock.slice(0, 2400)}` : '',
            'schema: {"primaryIntent":"db|rag|...|multi","isMulti":bool,"suggestedAgents":[],"isDbAnchored":bool,"needsAdmin":bool,"needsWeb":bool,"explicitWantsReport":bool,"explicitWantsVisualize":bool,"planShortcut":"none|...","dataSources":["rag"|"db"|"crawler"],"requiresAgentPipeline":bool,"allowChatWebDirect":bool,"confidence":0-1,"rationale":"..."}'
          ]
            .filter(Boolean)
            .join('\n\n')
        ]
      ],
      { tier: 'light' }
    )
    const rawText = String(r.text ?? '').trim()
    let rawObj = safeJsonParse(rawText)
    if (!rawObj) rawObj = parseFirstBalancedJsonObject(rawText)
    const parsed = IntentClassifySchema.safeParse(normalizeIntentClassifyPayload(rawObj))
    if (!parsed.success) return null
    if (Number(parsed.data.confidence) < 0.42) return null
    return parsed.data
  } catch {
    return null
  }
}
