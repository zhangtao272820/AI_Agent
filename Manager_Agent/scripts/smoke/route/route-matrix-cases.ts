/** 路由矩阵用例（离线拓扑 / 联机 probe / 编排 LLM 共用） */

export type RouteMatrixCase = {
  id: string
  label: string
  userTask: string
  /** 编排后期望出现在 allowedAgents 中的 agent（顺序无关） */
  expectCap: string[]
  /** 蓝图/计划必须覆盖的 agent */
  expectPlanAgents: string[]
  ragProbe?: string
  dbProbe?: string
}

/** 来自容器内实测：RAG docs_metadata + DB p2026 probe */
export const ROUTE_MATRIX_CASES: RouteMatrixCase[] = [
  {
    id: 'rag_only_finance',
    label: 'RAG 单源 · 个人财务',
    userTask: '在知识库中检索个人月度财务情况，计算实际可支配收入并简要说明。',
    expectCap: ['rag', 'code'],
    expectPlanAgents: ['rag', 'code'],
    ragProbe: '个人月度财务情况',
    dbProbe: '个人月度财务'
  },
  {
    id: 'db_only_age_chart',
    label: 'DB 单源 · 年龄段分布图',
    userTask: '数据库里老人按年龄段分布有多少人？生成柱状图。',
    expectCap: ['db', 'code', 'visualize'],
    expectPlanAgents: ['db', 'code', 'visualize'],
    dbProbe: '老人按年龄段分布有多少人'
  },
  {
    id: 'rag_admin_viz',
    label: 'RAG + 图表 + Admin（复合）',
    userTask:
      '在知识库中检索个人月度财务情况，提炼要点并生成对比图表，并帮我创建明天上午10点的会议日程，标题为「项目周会」，并设置会议提醒。',
    expectCap: ['rag', 'clean', 'code', 'admin', 'visualize'],
    expectPlanAgents: ['rag', 'admin', 'clean', 'code', 'visualize'],
    ragProbe: '个人月度财务情况'
  },
  {
    id: 'rag_db_dual',
    label: 'RAG + DB 双取数',
    userTask:
      '从知识库检索养老机构失能老人护理员配比标准，从数据库查询张三的慢性病血压血糖记录，对齐字段后做对比分析并生成图表。',
    expectCap: ['rag', 'db', 'clean', 'code', 'visualize'],
    expectPlanAgents: ['rag', 'db', 'clean', 'code', 'visualize'],
    ragProbe: '失能老人护理员配比',
    dbProbe: '查询张三的慢性病血压血糖记录'
  },
  {
    id: 'rag_db_report',
    label: 'RAG + DB · 报告',
    userTask:
      '知识库查失能老人补贴和高龄津贴标准，数据库查河西区70-79岁老人性别分布，写一份对比报告。',
    expectCap: ['rag', 'db', 'clean', 'code', 'report'],
    expectPlanAgents: ['rag', 'db', 'clean', 'code', 'report'],
    ragProbe: '失能老人补贴',
    dbProbe: '河西区老人性别分布'
  },
  {
    id: 'db_foot_pressure',
    label: 'DB · 足底压力',
    userTask: '查询足底压力检测一共多少次，并按检测时间做趋势图。',
    expectCap: ['db', 'code', 'visualize'],
    expectPlanAgents: ['db', 'code', 'visualize'],
    dbProbe: '足底压力检测一共多少次'
  },
  {
    id: 'db_psychology',
    label: 'DB · 情绪识别',
    userTask: '情绪识别仪检测记录有多少条？最近压力偏高的占比是多少？',
    expectCap: ['db', 'code'],
    expectPlanAgents: ['db', 'code'],
    dbProbe: '情绪识别仪检测记录有多少条'
  },
  {
    id: 'rag_nursing_doc',
    label: 'RAG · 养老规范',
    userTask: '在知识库中检索养老机构服务规范里关于半失能老人护理的要求。',
    expectCap: ['rag'],
    expectPlanAgents: ['rag'],
    ragProbe: '养老机构服务规范 半失能老人护理'
  }
]

/** 不应出现在 cap 中的「越界」agent（相对 expectCap） */
const SURPRISE_AGENTS = new Set(['rag', 'db', 'crawler', 'admin', 'gui', 'multimodal', 'music', 'video'])

export type RouteMatrixEval = {
  ok: boolean
  missingCap: string[]
  missingPlan: string[]
  spurious: string[]
  cap: string[]
  blueprintAgents: string[]
  dataSources: string[]
  planShortcut: string
  clauses: string
}

export function evaluateRouteMatrixCase(
  actualCap: string[],
  blueprintAgents: string[],
  expect: RouteMatrixCase,
  meta?: { dataSources?: string[]; planShortcut?: string; clauses?: Array<{ id: string; text: string; agents?: string[] }> }
): RouteMatrixEval {
  const have = new Set(actualCap)
  const bp = new Set(blueprintAgents)
  const missingCap = expect.expectCap.filter((a) => !have.has(a))
  const missingPlan = expect.expectPlanAgents.filter((a) => !bp.has(a) && !have.has(a))
  const spurious = actualCap.filter((a) => SURPRISE_AGENTS.has(a) && !expect.expectCap.includes(a))
  const clauses =
    meta?.clauses
      ?.map((c) => `${c.id}:${(c.agents ?? []).join('+') || '?'}`)
      .join(' | ') ?? ''
  return {
    ok: missingCap.length === 0 && missingPlan.length === 0 && spurious.length === 0,
    missingCap,
    missingPlan,
    spurious,
    cap: actualCap,
    blueprintAgents,
    dataSources: meta?.dataSources ?? [],
    planShortcut: meta?.planShortcut ?? '—',
    clauses
  }
}
