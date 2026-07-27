/**
 * search_then_crawl + SERP 种子 → structural crawl_seeds：
 * 跳过 policy/hints/lean，必须调用 Extractor，并将 seed 写入 managerTask。
 */
import { HumanMessage } from '@langchain/core/messages'
import {
  executeCrawlerStep,
  emptyPhaseTraceForTest,
  type CrawlerStepPhaseTrace
} from '../../../server/graph/core/executors/crawlerExecutor'
import type { AgentExecutorDeps, AgentExecutorOpts } from '../../../server/graph/core/executors/types'
import type { ManagerGraphState } from '../../../server/graph/state/state'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

async function main() {
  let extractorCalls = 0
  let llmInvokeCalls = 0
  let lastManagerTask: Record<string, unknown> | null = null
  const thinking: string[] = []

  const deps: AgentExecutorDeps = {
    callDbAgent: async () => ({ ok: true, answer: '' }) as never,
    callRagAgent: async () => '',
    callCrawlerAgent: async (input) => {
      extractorCalls += 1
      lastManagerTask =
        input.managerTask && typeof input.managerTask === 'object'
          ? (input.managerTask as Record<string, unknown>)
          : null
      return {
        items: [
          {
            title: '示例正文',
            url: 'https://example.com/guide',
            excerpt: '从种子页抽取的正文摘要',
            source: 'example.com'
          }
        ],
        status: 'ok',
        agentResult: { ok: true, structured: { itemCount: 1 } }
      }
    },
    callLobsterAgent: async () => ({}),
    callCodeAgent: async () => ({ answer: '' }),
    callAiAdminAgent: async () => ({}),
    callMultimodalAgent: async () => '',
    callMusicAgent: async () => '',
    callVideoAgent: async () => '',
    probeRagEvidence: async () => ({}),
    filterCrawlerResultDomestic: (x) => x,
    isDbNoData: () => false,
    ragRelevanceJudge: async () => ({ relevant: true, score: 1, rationale: 'smoke' }) as never,
    lastUserText: (messages) => {
      for (let i = (messages?.length ?? 0) - 1; i >= 0; i--) {
        const m = messages![i] as { content?: unknown; _getType?: () => string }
        const typ = typeof m?._getType === 'function' ? m._getType() : ''
        if (typ === 'human' || HumanMessage.isInstance(m)) return String(m.content ?? '').trim()
      }
      return ''
    }
  }

  const opts: AgentExecutorOpts = {
    runId: 'smoke-crawl-seeds-fastpath',
    timeoutMs: 5_000,
    dbAgentWsUrl: '',
    dbAgentHttpUrl: '',
    ragAgentHttpUrl: '',
    codeAgentWsUrl: '',
    crawlerAgentWsUrl: 'ws://127.0.0.1:9/_unused',
    lobsterAgentWsUrl: '',
    aiAdminAgentWsUrl: '',
    multimodalAgentHttpUrl: '',
    musicAgentWsUrl: '',
    videoAgentWsUrl: '',
    sendEvent: () => undefined
  }

  const taskText = '打开公开指南页面，抽取足底压力参考区间正文'
  const state = {
    messages: [new HumanMessage(taskText)],
    intent: 'multi',
    meta: {
      needsWebSearch: true,
      allowedAgents: ['db', 'crawler', 'report'],
      webExecutionMode: {
        mode: 'search_then_crawl',
        primaryAgent: 'crawler',
        needsWebSearch: true,
        serpSummaryEnough: false,
        confidence: 0.9,
        rationale: 'smoke'
      },
      searchHits: [
        {
          title: '足底压力参考',
          url: 'https://example.com/guide',
          snippet: '正常成人足弓指数参考约 0.21-0.26'
        },
        {
          title: '另一个开放页',
          url: 'https://example.org/ref',
          snippet: '参考区间说明'
        }
      ],
      seedUrls: ['https://example.com/guide', 'https://example.org/ref'],
      serpContext: '1. 足底压力参考 — 正常成人足弓指数参考约 0.21-0.26'
    }
  } as unknown as ManagerGraphState

  const phaseTraceOut: CrawlerStepPhaseTrace = emptyPhaseTraceForTest()
  const outcome = await executeCrawlerStep(deps, opts, {
    state,
    effQuery: taskText,
    timeoutMs: 5_000,
    sendThinking: (t) => thinking.push(t),
    allowRetry: false,
    llmInvoke: async () => {
      llmInvokeCalls += 1
      throw new Error('llmInvoke must not run on structural crawl_seeds path')
    },
    llm: {
      openaiApiKey: 'sk-test-unused',
      openaiModel: 'qwen-plus',
      openaiBaseUrl: 'http://127.0.0.1:9'
    },
    phaseTraceOut
  })

  assert(outcome.ok, 'crawl seeds fastpath should succeed')
  assert(extractorCalls === 1, `extractorCalls=${extractorCalls}`)
  assert(llmInvokeCalls === 0, `llmInvokeCalls=${llmInvokeCalls}`)
  assert(phaseTraceOut.path === 'structural_crawl_seeds', `path=${phaseTraceOut.path}`)
  assert(phaseTraceOut.calledPolicyLlm === false, 'policy LLM skipped')
  assert(phaseTraceOut.calledHintsLlm === false, 'hints LLM skipped')
  assert(phaseTraceOut.calledLeanLlm === false, 'lean LLM skipped')
  assert(phaseTraceOut.calledExtractor === true, 'extractor called')
  assert(lastManagerTask?.crawl_strategy === 'crawl_seeds', `strategy=${lastManagerTask?.crawl_strategy}`)
  const seeds = Array.isArray(lastManagerTask?.seed_urls) ? lastManagerTask!.seed_urls : []
  assert(seeds.length >= 1, 'seed_urls passed to Extractor')
  assert(
    thinking.some((t) => t.includes('SERP 种子精抓') || t.includes('深抓准备完成')),
    'thinking mentions seed crawl'
  )

  console.log('smoke-crawler-crawl-seeds-fastpath ok')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
