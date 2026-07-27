import { type Step } from '../../../utils/shared/taskPlan'
import { PIPELINE_AGENT_ORDER } from '../routing/clauses'

/** 规划/校验/补全共用的可执行 Agent 列表（须与 StepSchema、RouteSchema 一致） */
export const ALL_PLAN_AGENTS: Step['agent'][] = [
  'db',
  'rag',
  'code',
  'crawler',
  'admin',
  'visualize',
  'report',
  'clean',
  'multimodal',
  'music',
  'video'
]

const MEDIA_PLAN_AGENTS = new Set<Step['agent']>(['multimodal', 'music', 'video'])

export function isMediaOnlyCap(cap: Set<Step['agent']> | null): boolean {
  if (!cap || cap.size === 0) return false
  return [...cap].every((a) => MEDIA_PLAN_AGENTS.has(a))
}

export function coverageFallbackQuery(
  agent: Step['agent'],
  text: string,
  opts?: { needsWebSearch?: boolean; compositeDataWeb?: boolean; webMode?: string }
): string {
  const raw = String(text || '').replace(/\s+/g, ' ').trim()
  const excerpt =
    agent === 'rag' || agent === 'db' || agent === 'crawler'
      ? raw.slice(0, 200)
      : raw.slice(0, 320)
  switch (agent) {
    case 'rag':
      return `从知识库/文档中检索与任务直接相关的原文事实与条款（勿臆测）：${excerpt}`
    case 'db':
      return `从业务数据库查询与任务相关的结构化记录与统计口径（仅事实）：${excerpt}`
    case 'crawler':
      if (opts?.needsWebSearch || opts?.compositeDataWeb || opts?.webMode === 'search_serp_only') {
        return `基于 Manager 联网检索摘要，采集与用户任务相关的公开参考区间/指南要点/权威来源（勿跳过本步）：${excerpt}`
      }
      return `从公开网页采集与任务相关、可引用的客观信息：${excerpt}`
    case 'code':
      return `基于上游步骤产出的材料进行计算、对比与结构化汇总：${excerpt}`
    case 'admin':
      return `依据上游已确认的事实与约束，处理日程/提醒/邮件/待办等个人事务：${excerpt}`
    case 'visualize':
      return `基于上游事实生成图表方案（含 ECharts 所需维度与度量）：${excerpt}`
    case 'report':
      return `整合上游多源结果形成结论文本（结论、风险、建议需有依据）：${excerpt}`
    case 'clean':
      return `对已获得的数据做清洗、去重、规范化与字段对齐：${excerpt}`
    case 'multimodal':
      return `理解用户提供的图片/音频/视频内容并回答问题：${excerpt}`
    case 'music':
      return `根据描述生成音乐或 BGM：${excerpt}`
    case 'video':
      return `根据描述生成短视频：${excerpt}`
    default:
      return excerpt
  }
}

export type TaskConstraints = {
  timeHints: string[]
  subjectHints: string[]
  /** 路由 LLM 提取的字段/指标语义（供 DB schema 检索与 Code 事实对齐） */
  fieldHints?: string[]
  wantsVisualize: boolean
  wantsReport: boolean
}

export const ROUTE_CAP_MANDATORY_AGENTS = new Set<Step['agent']>([
  'db',
  'rag',
  'crawler',
  'gui',
  'admin',
  'multimodal',
  'music',
  'video'
])

export const COVERAGE_AGENT_ORDER = PIPELINE_AGENT_ORDER

export const PIPELINE_DOWNSTREAM_AGENTS = new Set<Step['agent']>(['code', 'visualize', 'report', 'admin'])
export const DATA_SOURCE_AGENTS_LOCAL = new Set<Step['agent']>(['rag', 'db', 'crawler'])
export const DATA_SOURCE_AGENTS = new Set<Step['agent']>(['rag', 'db', 'crawler'])

export function isPostCodeCleanStep(cleanStep: Step, plan: Step[]): boolean {
  const deps = (Array.isArray(cleanStep.dependsOn) ? cleanStep.dependsOn : [])
    .map((d) => String(d ?? '').trim())
    .filter(Boolean)
  if (!deps.length) return false
  return deps.every((d) => plan.find((s) => String(s.id) === d)?.agent === 'code')
}
