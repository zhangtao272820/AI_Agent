import { BaseMessage, HumanMessage } from '@langchain/core/messages'
import { extractManagerCoreQuestion, stripDbManagerPrefixes, stripPlanConstraintsFromQuery } from '#agent-shared/managerSubAgentProtocol'
import { normalizeEntities, type Intent, type Step, type TaskPlan } from '../../../utils/shared/taskPlan'
import { safeJsonParse } from '../shared/llmJson'
import type { TaskConstraints } from '../plan'
import { compositeMediaFromMeta, type CompositeMediaAgents } from '../../llm/mediaRouteLlm'
import { EMPTY_TASK_CONSTRAINTS } from '../../llm/taskConstraintsLlm'
import { resolveDbStepQuestionSync } from '../db/dbStepQuestion'
import { shouldRunNlCoalesce } from '../routing/nlResolve'
import {
  hasStructuralMultiLineBullets,
  isExplicitMultiRequest,
  preferCurrentTurnScope,
  routingConversationContext
} from './routingContext'

const CN_COMMERCIAL_HOST_RE =
  /(?:^|\.)douban\.com$|(?:^|\.)bilibili\.com$|(?:^|\.)weibo\.com$|(?:^|\.)zhihu\.com$|(?:^|\.)jd\.com$|(?:^|\.)163\.com$|(?:^|\.)qq\.com$|(?:^|\.)baidu\.com$|(?:^|\.)taobao\.com$|(?:^|\.)tmall\.com$/i

export function isDomesticUrl(url: string) {
  const u = String(url || '').trim()
  if (!u) return false
  try {
    const h = new URL(u).hostname.toLowerCase()
    if (CN_COMMERCIAL_HOST_RE.test(h)) return true
    const exactAllow = new Set(['gov.cn', 'www.gov.cn', 'news.cn', 'xinhuanet.com', 'people.com.cn', 'cctv.com', 'cnr.cn'])
    if (exactAllow.has(h)) return true
    const allowSuffix = ['.gov.cn', '.edu.cn', '.org.cn', '.com.cn', '.cn']
    return allowSuffix.some((s) => h.endsWith(s))
  } catch {
    return false
  }
}

export function filterCrawlerResultDomestic(obj: any) {
  if (!obj || typeof obj !== 'object') return obj
  const out: any = { ...obj }
  for (const k of ['results', 'items', 'data']) {
    const items = Array.isArray((out as any)[k]) ? (out as any)[k] : null
    if (!items) continue
    const filtered = items.filter((it: any) => isDomesticUrl(String((it || {}).url || '')))
    ;(out as any)[k] = filtered
  }
  return out
}

const STANDALONE_MEDIA_AGENTS = new Set(['music', 'video', 'multimodal'])

/** 用户上传附件且同时要求生成 music/video → 需 multimodal 先行；优先读 meta 缓存（路由 LLM 写入） */
export function detectCompositeMediaAgents(
  text: string,
  attachment?: { filePath?: string; mediaType?: string } | null,
  meta?: unknown
): CompositeMediaAgents | null {
  const cached = compositeMediaFromMeta(meta)
  if (cached) return cached
  if (!attachment?.filePath) return null
  return null
}

/** 附件或拆解器认定的单模态任务 → 仅走对应 Agent（复合媒体流水线除外） */
export function resolveStandaloneMediaRoute(
  lastUserText: string,
  attachment?: { filePath?: string; mediaType?: string } | null,
  meta?: { standaloneMediaRoute?: string } | null
): 'music' | 'video' | 'multimodal' | null {
  if (detectCompositeMediaAgents(lastUserText, attachment, meta)) return null
  const fromMeta = String(meta?.standaloneMediaRoute ?? '').trim()
  if (STANDALONE_MEDIA_AGENTS.has(fromMeta)) return fromMeta as 'music' | 'video' | 'multimodal'
  if (!attachment?.filePath) return null
  const mt = String(attachment.mediaType || '').toLowerCase()
  if (mt === 'audio') return 'multimodal'
  if (mt === 'video') return 'multimodal'
  if (mt === 'image' || !mt) return 'multimodal'
  return null
}

/** 单模态或本轮隔离时跳过历史经验回放，避免带偏识图/音乐类单任务 */
export function shouldSkipRouteHistoryBias(
  lastUserText: string,
  attachment?: { filePath?: string; mediaType?: string } | null,
  messages?: BaseMessage[]
): boolean {
  if (attachment?.filePath) return true
  if (messages && preferCurrentTurnScope(messages, lastUserText)) return true
  return false
}

export function isAttachmentCentricTask(_text: string, mediaType?: string): boolean {
  return Boolean(String(mediaType || '').trim())
}

export function shouldPreferMulti(text: string, _probe?: unknown) {
  return isExplicitMultiRequest(text)
}

/** 供 Router 注入 multi 建议：仅 LLM 子句拆解 + 结构性多行，不用关键词表 */
export function buildMultiRouteAdvisory(
  text: string,
  _probe?: { db?: { matched?: boolean }; rag?: { hits?: number } } | null,
  clauses?: Array<{ text: string; agents?: string[] }>,
  _lastTurnOnly?: string,
  attachment?: { filePath?: string; mediaType?: string } | null,
  meta?: unknown
): string {
  const composite = detectCompositeMediaAgents(text, attachment, meta)
  if (composite) {
    const label = composite.includes('music') ? '音乐' : '视频'
    return `【Multi 路由建议】\n用户上传附件并要求生成${label} → 必须 intent=multi，allowedAgents=${JSON.stringify(composite)}；music/video 须 dependsOn multimodal。`
  }
  if (attachment?.filePath) return ''
  const parts: string[] = []
  if (isExplicitMultiRequest(text)) {
    parts.push('用户输入含多行独立需求 → 建议 intent=multi，并列出完整 allowedAgents。')
  }
  const clauseList = Array.isArray(clauses) ? clauses.filter((c) => String(c?.text || '').trim().length >= 4) : []
  if (clauseList.length > 1) {
    const agentSet = new Set(clauseList.flatMap((c) => (Array.isArray(c.agents) ? c.agents : [])))
    const line = clauseList
      .map((c, i) => {
        const agents = Array.isArray(c.agents) && c.agents.length ? `[${c.agents.join('+')}]` : ''
        return `${i + 1}.${String(c.text).trim()}${agents}`
      })
      .join('；')
    parts.push(`拆解器已拆成 ${clauseList.length} 条子句：${line}`)
    if (agentSet.size >= 2) {
      parts.push(`子句指向 ${agentSet.size} 类不同 Agent（${[...agentSet].join('、')}）→ 必须 intent=multi，allowedAgents 覆盖全部执行 Agent。`)
    } else if (agentSet.size === 0 && clauseList.length >= 2) {
      parts.push('多条子句但 agent 未标注时，仍应按语义判断是否为 multi，并为每类数据源/输出单独安排 Agent。')
    }
  }
  return parts.length ? `【Multi 路由建议】\n${parts.join('\n')}` : ''
}

/** LLM 路由为单 Agent 时，仅当子句拆解明确多 Agent 才升级 multi */
export function shouldUpgradeRouteToMulti(
  text: string,
  _probe?: { db?: { matched?: boolean }; rag?: { hits?: number } } | null,
  clauses?: Array<{ text: string; agents?: string[] }>,
  _lastTurnOnly?: string,
  attachment?: { filePath?: string; mediaType?: string } | null,
  meta?: unknown
): boolean {
  if (detectCompositeMediaAgents(text, attachment, meta)) return true
  if (attachment?.filePath) return false
  const clauseList = Array.isArray(clauses) ? clauses.filter((c) => String(c?.text || '').trim().length >= 4) : []
  const clauseAgents = new Set(clauseList.flatMap((c) => (Array.isArray(c.agents) ? c.agents : [])))
  if (clauseList.length > 1 && clauseAgents.size >= 2) return true
  return isExplicitMultiRequest(text) && clauseList.length > 1
}

export function mergeRouteAllowedAgents(
  llmAllowed: Step['agent'][],
  _text: string,
  clauses?: Array<{ text: string; agents?: string[] }>
): Step['agent'][] {
  const merged = new Set<Step['agent']>(llmAllowed)
  for (const c of clauses || []) {
    for (const a of Array.isArray(c.agents) ? c.agents : []) {
      if (typeof a === 'string' && a.trim()) merged.add(a as Step['agent'])
    }
  }
  return [...merged]
}

/** 取数前置由 Planner LLM + allowedAgents 决定 */
export function needsDataFoundation(_text: string) {
  return false
}

export function hasStrongDbAnchor(text: string) {
  const q = String(text ?? '').trim()
  if (!q) return false
  return /\b(select|from|join|where)\b/i.test(q)
}
