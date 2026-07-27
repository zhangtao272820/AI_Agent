import { z } from 'zod'
import { safeJsonParse } from '../../graph/core/shared/llmJson'
import type { LlmInvokeFn } from '../../graph/llm/taskConstraintsLlm'
import { filterLowRiskSeedUrls } from './crawlSeedRisk'

const CrawlerExecPolicySchema = z.object({
  strategy: z.enum(['serp_only', 'crawl_seeds', 'open_discovery']),
  filteredSeedUrls: z.array(z.string()).max(12).default([]),
  confidence: z.number().min(0).max(1),
  rationale: z.string().max(480).default('')
})

export type CrawlerExecutionPolicy = z.infer<typeof CrawlerExecPolicySchema>

export function isCrawlerExecutionPolicyLlmEnabled(): boolean {
  return String(process.env.MANAGER_CRAWLER_EXEC_POLICY_LLM ?? '1').trim() !== '0'
}

/**
 * 爬虫执行策略（LLM）：是否仅用 SERP 摘要、精抓哪些种子、或开放式发现。
 * 避免对验证码/登录墙页面做长时间浏览器抓取。
 */
export async function resolveCrawlerExecutionPolicyByLlm(input: {
  taskText: string
  serpContext?: string
  seedUrls?: string[]
  searchHitCount?: number
  llmInvoke?: LlmInvokeFn | null
  state?: unknown
}): Promise<CrawlerExecutionPolicy | null> {
  if (!isCrawlerExecutionPolicyLlmEnabled()) return null
  const task = String(input.taskText || '').trim()
  if (task.length < 4) return null

  const seeds = (input.seedUrls || []).map((u) => String(u).trim()).filter(Boolean).slice(0, 12)
  const serp = String(input.serpContext || '').trim().slice(0, 2000)
  const hitCount = Number(input.searchHitCount ?? 0)

  const invoke = async (messages: unknown[]) => {
    if (input.llmInvoke && input.state) {
      const r = await input.llmInvoke('route', input.state, messages as never, { tier: 'light' })
      return String(r.text ?? '').trim()
    }
    return ''
  }

  try {
    const raw = await invoke([
      [
        'system',
        [
          '你是总管爬虫执行策略节点。根据用户任务与已有联网检索结果，决定如何获取公开网页信息。',
          '禁止用关键词表硬套；按语义理解任务是否需要全文抓取。',
          'strategy 规则：',
          '- serp_only：对比/参考/公开资料汇总/政策说明等，SERP 摘要已足够；或种子 URL 多为问答站/验证码/登录墙，浏览器抓取价值低。',
          '- crawl_seeds：用户需要正文、榜单字段、具体页面数据；filteredSeedUrls 从候选种子中选出值得精抓的 URL（最多 6 个），跳过明显问答验证码页。',
          '- open_discovery：无可靠种子且任务为开放式公网发现（仍应优先 SERP 已有摘要，勿盲目深抓）。',
          '若已有 SERP 摘要且任务未要求「打开页面全文/列表字段抽取」，优先 serp_only。',
          'schema: {"strategy":"serp_only|crawl_seeds|open_discovery","filteredSeedUrls":[],"confidence":0-1,"rationale":"..."}'
        ].join('\n')
      ],
      [
        'human',
        [
          `【用户任务】\n${task.slice(0, 1200)}`,
          hitCount ? `【SERP 命中数】${hitCount}` : '',
          serp ? `【SERP 摘要】\n${serp}` : '【SERP 摘要】（无）',
          seeds.length ? `【候选种子 URL】\n${seeds.join('\n')}` : '【候选种子 URL】（无）'
        ]
          .filter(Boolean)
          .join('\n\n')
      ]
    ])
    if (!raw) return null
    const parsed = CrawlerExecPolicySchema.safeParse(safeJsonParse(raw))
    if (!parsed.success) {
      return inferCrawlerExecPolicyFallbackByLlm(input, { serp, hitCount, seeds, invoke })
    }
    if (Number(parsed.data.confidence) < 0.48) {
      return inferCrawlerExecPolicyFallbackByLlm(input, { serp, hitCount, seeds, invoke })
    }
    let strategy = parsed.data.strategy
    let filtered = parsed.data.filteredSeedUrls
      .map((u) => String(u).trim())
      .filter((u) => /^https?:\/\//i.test(u) && seeds.includes(u))

    if (strategy === 'crawl_seeds') {
      const candidateSeeds = filtered.length ? filtered : seeds
      const lowRisk = filterLowRiskSeedUrls(candidateSeeds, 6)
      const worth = await filterSeedsWorthCrawlingByLlm({
        task,
        serp,
        seedUrls: lowRisk.length ? lowRisk : candidateSeeds,
        llmInvoke: input.llmInvoke,
        state: input.state,
        invoke
      })
      filtered = worth
      if (!filtered.length && (serp.length > 120 || hitCount >= 2)) {
        strategy = 'serp_only'
      } else if (!filtered.length && lowRisk.length) {
        filtered = lowRisk
      }
    }

    return {
      ...parsed.data,
      strategy,
      filteredSeedUrls: strategy === 'crawl_seeds' ? filtered : [],
      rationale:
        strategy === 'serp_only' && parsed.data.strategy === 'crawl_seeds'
          ? `${parsed.data.rationale}；无可安全精抓种子，改用 SERP 摘要`
          : parsed.data.rationale
    }
  } catch {
    return null
  }
}

const SeedWorthSchema = z.object({
  worthCrawling: z.array(z.string()).max(6).default([]),
  confidence: z.number().min(0).max(1).optional(),
  rationale: z.string().max(320).optional()
})

/** LLM 从候选种子中挑出值得浏览器精抓的 URL（跳过验证码/问答墙等） */
async function filterSeedsWorthCrawlingByLlm(input: {
  task: string
  serp: string
  seedUrls: string[]
  llmInvoke?: LlmInvokeFn | null
  state?: unknown
  invoke: (messages: unknown[]) => Promise<string>
}): Promise<string[]> {
  const seeds = (input.seedUrls || []).slice(0, 12)
  if (!seeds.length) return []
  try {
    const raw = await input.invoke([
      [
        'system',
        [
          '你是爬虫种子筛选器。根据用户任务语义，从候选 URL 中选出「值得浏览器/云抓取正文」的少量链接。',
          'worthCrawling 留空：任务只需公开资料对照/对比/汇总/参考，或候选多为问答站/验证码/登录墙/社区帖。',
          'worthCrawling 非空：用户明确需要页面正文、榜单字段、官方文档全文等；优先权威/官方/新闻源。',
          '禁止用域名关键词表硬套；按页面类型与任务需求判断。',
          'schema: {"worthCrawling":["url"],"confidence":0-1,"rationale":"..."}'
        ].join('\n')
      ],
      [
        'human',
        [
          `【用户任务】\n${input.task.slice(0, 900)}`,
          input.serp ? `【SERP 摘要】\n${input.serp.slice(0, 1200)}` : '',
          `【候选 URL】\n${seeds.join('\n')}`
        ]
          .filter(Boolean)
          .join('\n\n')
      ]
    ])
    if (!raw) return seeds.slice(0, Math.min(3, seeds.length))
    const parsed = SeedWorthSchema.safeParse(safeJsonParse(raw))
    if (!parsed.success || Number(parsed.data.confidence ?? 0) < 0.45) {
      return seeds.slice(0, Math.min(3, seeds.length))
    }
    const picked = parsed.data.worthCrawling
      .map((u) => String(u).trim())
      .filter((u) => /^https?:\/\//i.test(u) && seeds.includes(u))
    return picked
  } catch {
    return seeds.slice(0, Math.min(3, seeds.length))
  }
}

/** 主策略 LLM 失败或低置信时：SERP 已充分则默认 serp_only */
async function inferCrawlerExecPolicyFallbackByLlm(
  input: {
    taskText: string
    serpContext?: string
    seedUrls?: string[]
    searchHitCount?: number
    llmInvoke?: LlmInvokeFn | null
    state?: unknown
  },
  ctx: {
    serp: string
    hitCount: number
    seeds: string[]
    invoke: (messages: unknown[]) => Promise<string>
  }
): Promise<CrawlerExecutionPolicy | null> {
  if (ctx.serp.length < 80 && ctx.hitCount < 2) return null
  try {
    const raw = await ctx.invoke([
      [
        'system',
        [
          '你是爬虫执行策略兜底节点。已有 Manager 联网检索结果，判断用户是否仍需浏览器深抓。',
          '若任务是对比/汇总/参考公开资料、政策说明、新闻概览，且 SERP 摘要已覆盖要点 → serp_only。',
          '若必须页面全文/榜单字段/用户给定 URL 正文 → crawl_seeds 或 open_discovery。',
          'schema: {"strategy":"serp_only|crawl_seeds|open_discovery","filteredSeedUrls":[],"confidence":0-1,"rationale":"..."}'
        ].join('\n')
      ],
      [
        'human',
        [
          `【用户任务】\n${String(input.taskText || '').slice(0, 1000)}`,
          ctx.hitCount ? `【SERP 命中数】${ctx.hitCount}` : '',
          ctx.serp ? `【SERP 摘要】\n${ctx.serp.slice(0, 1600)}` : '',
          ctx.seeds.length ? `【种子 URL】\n${ctx.seeds.slice(0, 8).join('\n')}` : ''
        ]
          .filter(Boolean)
          .join('\n\n')
      ]
    ])
    if (!raw) return null
    const parsed = CrawlerExecPolicySchema.safeParse(safeJsonParse(raw))
    if (!parsed.success || Number(parsed.data.confidence) < 0.45) return null
    return {
      ...parsed.data,
      filteredSeedUrls: []
    }
  } catch {
    return null
  }
}
