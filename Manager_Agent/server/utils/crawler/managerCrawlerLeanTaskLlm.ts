import { z } from 'zod'
import { ChatOpenAI } from '@langchain/openai'
import { safeJsonParse } from '../../graph/core/shared/llmJson'

const LeanTaskSchema = z.object({
  task: z.string().min(2).max(1200),
  confidence: z.number().min(0).max(1).optional()
})

const CRAWLER_PREFIXES = [
  '从互联网抓取',
  '从网页抓取',
  '抓取互联网',
  '爬取互联网',
  '联网抓取',
  '联网爬取',
  '进行开放式发现搜索',
  '从互联网获取',
] as const

const DB_POLLUTION_MARKERS = ['从数据库', '知识库', 'SQL'] as const

function stripStructural(stepOrRouted: string, lastUserMessage: string): string {
  let q = String(stepOrRouted ?? '').trim()
  const last = String(lastUserMessage ?? '').trim()
  if (DB_POLLUTION_MARKERS.some((m) => q.includes(m)) && last.length >= 4 && last.length <= 800) q = last
  for (const p of CRAWLER_PREFIXES) {
    if (q.startsWith(p)) {
      q = q.slice(p.length).replace(/^相关[数据信息内容]*/, '').replace(/^[:：\s]+/, '').trim()
      break
    }
  }
  if (q.endsWith('，并生成报告')) q = q.slice(0, -'，并生成报告'.length).trim()
  else if (q.endsWith('并生成报告')) q = q.slice(0, -'并生成报告'.length).replace(/[，,]\s*$/, '').trim()
  const cut = q.indexOf('\n\n要求：')
  if (cut > 0) q = q.slice(0, cut).trim()
  return (q || last).trim()
}

export function isCrawlerLeanTaskLlmEnabled(): boolean {
  return String(process.env.MANAGER_CRAWLER_LEAN_TASK_LLM ?? '1').trim() !== '0'
}

export async function refineCrawlerLeanTaskByLlm(input: {
  stepOrRouted: string
  lastUserMessage: string
  llm?: { openaiApiKey?: string; openaiModel?: string; openaiBaseUrl?: string } | null
}): Promise<string | null> {
  if (!isCrawlerLeanTaskLlmEnabled()) return null
  const routed = String(input.stepOrRouted ?? '').trim()
  const last = String(input.lastUserMessage ?? '').trim()
  if (!routed && !last) return null
  const key = String(input.llm?.openaiApiKey ?? process.env.OPENAI_API_KEY ?? '').trim()
  if (!key) return null
  try {
    const model = new ChatOpenAI({
      apiKey: key,
      modelName: String(input.llm?.openaiModel || process.env.OPENAI_MODEL || 'gpt-4o-mini').trim(),
      configuration: { baseURL: input.llm?.openaiBaseUrl || process.env.OPENAI_BASE_URL },
      temperature: 0
    })
    const res = await model.invoke([
      [
        'system',
        [
          '你是网页抓取任务精炼器。将总管路由模板改写为 Extractor 可执行的短任务。',
          '去掉数据库/知识库/报告/汇总等非抓取指令；保留站点、数量、字段、URL。',
          'schema: {"task":string,"confidence":number}',
        ].join('\n')
      ],
      [
        'human',
        [last ? `用户原话：${last.slice(0, 800)}` : '', routed && routed !== last ? `路由任务：${routed.slice(0, 900)}` : '']
          .filter(Boolean)
          .join('\n\n')
      ]
    ])
    const parsed = LeanTaskSchema.safeParse(safeJsonParse(String(res.content ?? '').trim()))
    if (!parsed.success || Number(parsed.data.confidence ?? 0) < 0.5) return null
    const task = String(parsed.data.task ?? '').trim()
    return task.length >= 2 ? task.slice(0, 1200) : null
  } catch {
    return null
  }
}

export async function resolveLeanCrawlerUserTaskAsync(input: {
  stepOrRouted: string
  lastUserMessage: string
  llm?: { openaiApiKey?: string; openaiModel?: string; openaiBaseUrl?: string } | null
}): Promise<string> {
  const fallback = stripStructural(input.stepOrRouted, input.lastUserMessage)
  const refined = await refineCrawlerLeanTaskByLlm(input)
  return refined ?? fallback
}

/** 同步 fallback（结构性 strip，无业务正则分类） */
export function buildLeanCrawlerUserTaskSync(stepOrRouted: string, lastUserMessage: string): string {
  return stripStructural(stepOrRouted, lastUserMessage)
}
