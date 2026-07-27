/**
 * crawler 结构性 SERP 快路径：search_serp_only + 已有 SERP 时
 * 不得触达 policy/hints/lean LLM，也不得 callCrawlerAgent。
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
  const thinking: string[] = []

  const deps: AgentExecutorDeps = {
    callDbAgent: async () => ({ ok: true, answer: '' }) as never,
    callRagAgent: async () => '',
    callCrawlerAgent: async () => {
      extractorCalls += 1
      throw new Error('Extractor must not be called on structural serp_only path')
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
    runId: 'smoke-serp-fastpath',
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

  const taskText = '对照公开资料汇总足底压力参考区间'
  const state = {
    messages: [new HumanMessage(taskText)],
    intent: 'multi',
    meta: {
      needsWebSearch: true,
      allowedAgents: ['db', 'crawler', 'report'],
      webExecutionMode: {
        mode: 'search_serp_only',
        primaryAgent: 'crawler',
        needsWebSearch: true,
        serpSummaryEnough: true,
        confidence: 0.9,
        rationale: 'smoke'
      },
      searchHits: [
        {
          title: '足底压力参考',
          url: 'https://example.com/guide',
          snippet: '正常成人足弓指数参考约 0.21-0.26'
        }
      ],
      seedUrls: ['https://example.com/guide'],
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
      throw new Error('llmInvoke must not run on structural serp_only path')
    },
    llm: {
      openaiApiKey: 'sk-test-unused',
      openaiModel: 'qwen-plus',
      openaiBaseUrl: 'http://127.0.0.1:9'
    },
    phaseTraceOut
  })

  assert(outcome.ok, 'serp fastpath should succeed')
  assert(outcome.evidence && (outcome.evidence as { serpOnly?: boolean }).serpOnly === true, 'evidence.serpOnly')
  assert(String(outcome.output || '').includes('联网检索摘要'), 'output uses SERP note')
  assert(extractorCalls === 0, `extractorCalls=${extractorCalls}`)
  assert(llmInvokeCalls === 0, `llmInvokeCalls=${llmInvokeCalls}`)
  assert(phaseTraceOut.path === 'structural_serp_only', `path=${phaseTraceOut.path}`)
  assert(phaseTraceOut.calledPolicyLlm === false, 'policy LLM skipped')
  assert(phaseTraceOut.calledHintsLlm === false, 'hints LLM skipped')
  assert(phaseTraceOut.calledLeanLlm === false, 'lean LLM skipped')
  assert(phaseTraceOut.calledExtractor === false, 'extractor skipped')
  assert(
    thinking.some((t) => t.includes('hints=skipped') && t.includes('extractor=skipped')),
    'thinking includes phase timing'
  )

  console.log('smoke-crawler-serp-fastpath ok')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
