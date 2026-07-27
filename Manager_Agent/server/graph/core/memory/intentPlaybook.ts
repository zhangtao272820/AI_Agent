import type { PlanShortcutKind } from '../../llm/intentClassifyLlm'

/** 泛化意图样例（预泛化 paraphrase，供向量召回；非单场景 regex） */
export type IntentPlaybookEntry = {
  id: string
  /** 多种口语表述，embedding 取 max 相似度 */
  paraphrases: string[]
  primaryIntent:
    | 'db'
    | 'rag'
    | 'code'
    | 'crawler'
    | 'gui'
    | 'admin'
    | 'clean'
    | 'visualize'
    | 'report'
    | 'multimodal'
    | 'music'
    | 'video'
    | 'multi'
  isMulti: boolean
  suggestedAgents: string[]
  isDbAnchored: boolean
  needsAdmin: boolean
  needsWeb: boolean
  explicitWantsReport: boolean
  explicitWantsVisualize: boolean
  planShortcut: PlanShortcutKind
  dataPlane: 'db' | 'rag' | 'web' | 'admin' | 'media' | 'mixed' | 'none'
  note: string
}

/**
 * 总管意图 Playbook：跨领域泛化表述 → 路由拓扑先验。
 * 新增领域优先加 paraphrase，勿写问句级 hardcode 分支。
 */
export const MANAGER_INTENT_PLAYBOOK: IntentPlaybookEntry[] = [
  {
    id: 'db_lookup_person',
    paraphrases: [
      '在数据库里查某人的检测记录',
      '从业务库表查询结构化数据并汇总',
      '帮我查一下库里这个人的测试明细',
      'SQL 查表拿原始记录'
    ],
    primaryIntent: 'db',
    isMulti: false,
    suggestedAgents: ['db'],
    isDbAnchored: true,
    needsAdmin: false,
    needsWeb: false,
    explicitWantsReport: false,
    explicitWantsVisualize: false,
    planShortcut: 'db_only',
    dataPlane: 'db',
    note: '纯结构化库表取数，无图表/报告/知识库并列'
  },
  {
    id: 'db_chart',
    paraphrases: [
      '查销售数据并画柱状图',
      '从数据库统计后做可视化图表',
      '查表出 Top 排名图',
      '库表取数生成 ECharts'
    ],
    primaryIntent: 'multi',
    isMulti: true,
    suggestedAgents: ['db', 'visualize'],
    isDbAnchored: true,
    needsAdmin: false,
    needsWeb: false,
    explicitWantsReport: false,
    explicitWantsVisualize: true,
    planShortcut: 'db_chart',
    dataPlane: 'db',
    note: '查库 + 图表（db_chart 快捷路径：db→visualize）'
  },
  {
    id: 'rag_doc_qa',
    paraphrases: [
      '根据知识库文档回答制度是什么',
      '从手册里找政策条款说明',
      '文档里这个概念什么意思',
      '检索内部资料解释规范'
    ],
    primaryIntent: 'rag',
    isMulti: false,
    suggestedAgents: ['rag'],
    isDbAnchored: false,
    needsAdmin: false,
    needsWeb: false,
    explicitWantsReport: false,
    explicitWantsVisualize: false,
    planShortcut: 'rag_only',
    dataPlane: 'rag',
    note: '纯知识库/文档问答'
  },
  {
    id: 'rag_lookup_values',
    paraphrases: [
      '在知识库中查询某指标分别是多少',
      '从知识库查两个测试数值各是多少',
      '知识库里查多个指标的具体数值',
      '检索文档里各项测试时长与得分'
    ],
    primaryIntent: 'rag',
    isMulti: false,
    suggestedAgents: ['rag'],
    isDbAnchored: false,
    needsAdmin: false,
    needsWeb: false,
    explicitWantsReport: false,
    explicitWantsVisualize: false,
    planShortcut: 'rag_only',
    dataPlane: 'rag',
    note: '同一知识源内多问数值/指标，仍属纯检索，非 multi 流水线'
  },
  {
    id: 'rag_finance_kb',
    paraphrases: [
      '在知识库中查询我的月度财务状况',
      '从知识库查个人月度收入支出',
      '知识库里我的财务情况怎么样',
      '检索文档中的月度收支结余'
    ],
    primaryIntent: 'rag',
    isMulti: false,
    suggestedAgents: ['rag'],
    isDbAnchored: false,
    needsAdmin: false,
    needsWeb: false,
    explicitWantsReport: false,
    explicitWantsVisualize: false,
    planShortcut: 'rag_only',
    dataPlane: 'rag',
    note: '纯知识库财务指标查询，非报告/图表流水线'
  },
  {
    id: 'admin_schedule',
    paraphrases: [
      '帮我创建明天上午的会议并设提醒',
      '添加待办事项到日历',
      '发一封邮件通知同事',
      '安排下周的项目周会'
    ],
    primaryIntent: 'admin',
    isMulti: false,
    suggestedAgents: ['admin'],
    isDbAnchored: false,
    needsAdmin: true,
    needsWeb: false,
    explicitWantsReport: false,
    explicitWantsVisualize: false,
    planShortcut: 'admin_only',
    dataPlane: 'admin',
    note: '办公事务：日程/邮件/待办'
  },
  {
    id: 'admin_map_route',
    paraphrases: [
      '公交从这到火车站要多久',
      '附近有什么咖啡店',
      '怎么去这个地址',
      '导航看一下通勤时间'
    ],
    primaryIntent: 'admin',
    isMulti: false,
    suggestedAgents: ['admin'],
    isDbAnchored: false,
    needsAdmin: true,
    needsWeb: false,
    explicitWantsReport: false,
    explicitWantsVisualize: false,
    planShortcut: 'admin_only',
    dataPlane: 'admin',
    note: '高德路线/周边/地址（admin 内置）'
  },
  {
    id: 'multi_compare_sources',
    paraphrases: [
      '分别查库和查文档再对比分析',
      '数据库实测值与知识库参考范围对比写报告',
      '多源数据汇总后出结论',
      '先检索两路信息再生成对比报告'
    ],
    primaryIntent: 'multi',
    isMulti: true,
    suggestedAgents: ['db', 'rag', 'clean', 'code', 'report'],
    isDbAnchored: true,
    needsAdmin: false,
    needsWeb: false,
    explicitWantsReport: true,
    explicitWantsVisualize: false,
    planShortcut: 'none',
    dataPlane: 'mixed',
    note: '多源对比 → multi，禁止单 Agent 吞整句'
  },
  {
    id: 'web_search_news',
    paraphrases: [
      '搜一下最近的政策新闻',
      '联网查今日汇率公告',
      '网上最新的行业价格是多少',
      '实时检索公开网页摘要'
    ],
    primaryIntent: 'multi',
    isMulti: true,
    suggestedAgents: ['crawler', 'report'],
    isDbAnchored: false,
    needsAdmin: false,
    needsWeb: true,
    explicitWantsReport: false,
    explicitWantsVisualize: false,
    planShortcut: 'none',
    dataPlane: 'web',
    note: '实时公网摘要 → needsWebSearch + crawler'
  },
  {
    id: 'gui_form_submit',
    paraphrases: [
      '登录后台系统并提交表单',
      '在 OA 页面里点击保存',
      '浏览器里填表并截图',
      '需要交互式网页操作的任务'
    ],
    primaryIntent: 'gui',
    isMulti: false,
    suggestedAgents: ['gui'],
    isDbAnchored: false,
    needsAdmin: false,
    needsWeb: false,
    explicitWantsReport: false,
    explicitWantsVisualize: false,
    planShortcut: 'none',
    dataPlane: 'web',
    note: '交互式页面操作 → gui，非 crawler'
  },
  {
    id: 'media_image_describe',
    paraphrases: [
      '描述这张图片里有什么',
      '识别附件图片的文字内容',
      '帮我看看上传的图',
      'OCR 这张截图'
    ],
    primaryIntent: 'multimodal',
    isMulti: false,
    suggestedAgents: ['multimodal'],
    isDbAnchored: false,
    needsAdmin: false,
    needsWeb: false,
    explicitWantsReport: false,
    explicitWantsVisualize: false,
    planShortcut: 'none',
    dataPlane: 'media',
    note: '识图/OCR → multimodal'
  },
  {
    id: 'media_music_gen',
    paraphrases: [
      '生成一段轻松的背景音乐',
      '作一首纯音乐 BGM',
      '根据氛围写旋律'
    ],
    primaryIntent: 'music',
    isMulti: false,
    suggestedAgents: ['music'],
    isDbAnchored: false,
    needsAdmin: false,
    needsWeb: false,
    explicitWantsReport: false,
    explicitWantsVisualize: false,
    planShortcut: 'none',
    dataPlane: 'media',
    note: '独立音乐生成，无附件识图'
  },
  {
    id: 'media_video_gen',
    paraphrases: [
      '根据描述生成一段短视频',
      '文生视频做一个宣传片',
      '做一个新的视频片段'
    ],
    primaryIntent: 'video',
    isMulti: false,
    suggestedAgents: ['video'],
    isDbAnchored: false,
    needsAdmin: false,
    needsWeb: false,
    explicitWantsReport: false,
    explicitWantsVisualize: false,
    planShortcut: 'none',
    dataPlane: 'media',
    note: '文生视频 → video'
  },
  {
    id: 'rag_chart_report',
    paraphrases: [
      '从知识库取财务数据画对比图',
      '检索文档后计算并生成分析报告',
      '文档里的指标做成图表和结论'
    ],
    primaryIntent: 'multi',
    isMulti: true,
    suggestedAgents: ['rag', 'code', 'visualize', 'report'],
    isDbAnchored: false,
    needsAdmin: false,
    needsWeb: false,
    explicitWantsReport: true,
    explicitWantsVisualize: true,
    planShortcut: 'none',
    dataPlane: 'rag',
    note: '知识库单源 + 用户显式图表/报告；多源时才需 clean'
  },
  {
    id: 'rag_compliance_norm_lookup',
    paraphrases: [
      '从知识库制度文档中提取合规指标数值',
      '检索手册里某类对象的配比或比例要求',
      '知识库规范文档中的指标阈值是多少',
      '文档规范里按人群分类的配置比例'
    ],
    primaryIntent: 'rag',
    isMulti: false,
    suggestedAgents: ['rag'],
    isDbAnchored: false,
    needsAdmin: false,
    needsWeb: false,
    explicitWantsReport: false,
    explicitWantsVisualize: false,
    planShortcut: 'rag_only',
    dataPlane: 'rag',
    note: '制度/规范类纯检索，非图表流水线'
  },
  {
    id: 'db_report',
    paraphrases: [
      '查数据库记录后写分析报告',
      '从表里汇总数据生成报告结论',
      '库表查询结果整理成文字报告'
    ],
    primaryIntent: 'multi',
    isMulti: true,
    suggestedAgents: ['db', 'clean', 'code', 'report'],
    isDbAnchored: true,
    needsAdmin: false,
    needsWeb: false,
    explicitWantsReport: true,
    explicitWantsVisualize: false,
    planShortcut: 'none',
    dataPlane: 'db',
    note: '查库 + 报告，非 db_only 短路'
  },
  {
    id: 'multi_fetch_admin',
    paraphrases: [
      '查完数据后帮我创建会议提醒',
      '分析结果出来后安排明天日程',
      '检索知识库并添加待办'
    ],
    primaryIntent: 'multi',
    isMulti: true,
    suggestedAgents: ['rag', 'admin'],
    isDbAnchored: false,
    needsAdmin: true,
    needsWeb: false,
    explicitWantsReport: false,
    explicitWantsVisualize: false,
    planShortcut: 'none',
    dataPlane: 'mixed',
    note: '取数/检索 + 办公事务并列'
  }
]

export function intentPlaybookById(id: string): IntentPlaybookEntry | undefined {
  return MANAGER_INTENT_PLAYBOOK.find((e) => e.id === id)
}
