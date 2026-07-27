import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { buildInternalCollabContext } from '../output/downstreamContext'
import {
  CODE_AUTHORITY_RULE,
  hasCodeInResults,
  mergeFactsWithCodePriority
} from '#agent-shared/codeFirstAuthority'
import { assessDataSufficiencyStructural } from '#agent-shared/cleanPayload'
import { isReportDeferredToSynth } from '#agent-shared/reportSynthDefer'
import { tryCodeAuthorityDownstreamOutput } from '../../../utils/code/managerCodeDownstream'

import { resolveInternalCollaboratorModel } from '../shared/modelTier'
import {
  extendResourcesDeadlineIfNeeded,
  resolveInternalAgentTimeoutMs
} from '../shared/llmSpeed'

type InternalKind = 'visualize' | 'report' | 'clean'

export type CreateInternalCollaboratorsDeps = {
  opts: {
    sendEvent: (event: { event: string; data?: any; from?: string }) => void
    openaiModel: string
    runId: string
  }
  getModel: (modelName: string, temperature?: number) => { invoke: (messages: any[]) => Promise<any> }
  traceRun: <T>(name: string, fn: () => Promise<T>, extra?: Record<string, any>) => Promise<T>
  extractTotalTokens: (resp: any) => number | undefined
  estimateTokensFromMessages: (messages: any[]) => number
  estimateTokensFromText: (text: string) => number
  mergeResources: (state: any, patch: Record<string, any>) => Record<string, any>
  appendMetrics: (entry: { runId: string; phase: string; ms: number; tokens?: number; usd?: number; model?: string }) => Promise<void>
  timeLeftMs: (resources: any) => number
  extractStructuredPayload: (text: string) => { facts: any[] }
  emitTrace: (data: any, from?: string) => void
  summarize: (text: string, max?: number) => string
}

export function createInternalCollaborators(deps: CreateInternalCollaboratorsDeps) {
  const {
    opts,
    getModel,
    traceRun,
    extractTotalTokens,
    estimateTokensFromMessages,
    estimateTokensFromText,
    mergeResources,
    appendMetrics,
    timeLeftMs,
    extractStructuredPayload,
    emitTrace,
    summarize
  } = deps

  const internalAgentEnabled = (kind: InternalKind) => {
    const key =
      kind === 'visualize'
        ? 'MANAGER_ENABLE_VISUALIZE_AGENT'
        : kind === 'report'
          ? 'MANAGER_ENABLE_REPORT_AGENT'
          : 'MANAGER_ENABLE_CLEAN_AGENT'
    const v = String(process.env[key] ?? 'true').trim().toLowerCase()
    return !(v === '0' || v === 'false' || v === 'off' || v === 'no')
  }

  const runInternalAgent = async (
    kind: InternalKind,
    question: string,
    state: any,
    contextInput?: any
  ) => {
    if (!internalAgentEnabled(kind)) return `内置 ${kind} Agent 已在环境变量中禁用。`
    const title = kind === 'visualize' ? '可视化 Agent' : kind === 'report' ? '报告 Agent' : '数据清洗 Agent'
    const style =
      kind === 'visualize'
        ? [
            '目标：把现有事实转成可视化可落地的输出。',
            '输出要求（必须严格遵守以下标记格式）：',
            '1) 只输出图表：<!--ECHARTS_OPTION-->...<!--/ECHARTS_OPTION-->（ECharts JSON，可直接渲染）；',
            '2) 可选 <!--TABLE_DATA-->，但表格仅含 chart series 中的指标，禁止 dump 全部上游 facts；',
            '3) 同一图表只含同一 comparable_group + unit_kind；percent/ratio 与 currency 分 panel；',
            '4) 若存在 Code 步骤必须走 Code 权威数字；label 用任务语言，禁止展示 raw snake_case key。',
            CODE_AUTHORITY_RULE,
            hasCodeInResults(state?.results)
              ? '【强制】已存在 Code 步骤：须优先使用 Code 权威管线；本 LLM 仅作兜底，数字必须来自 Code。'
              : '',
            '5) 若数据不足，说明缺失字段（不超过2条）；除标记块外不要大段解释。'
          ]
        : kind === 'report'
          ? [
              '目标：整合多源结果形成结构化报告。',
              '输出要求（必须严格遵守以下标记格式）：',
              '1) 核心结论（2-4条，每条不超过40字）；',
              '2) 关键数据依据（引用已知事实，不超过4条）；',
              '3) 风险与不确定性（不超过2条）；',
              '4) 下一步行动建议（可执行，不超过3条）；',
              '5) 将完整报告内容包裹在标记中：\n<!--REPORT-->\n...报告正文...\n<!--/REPORT-->\n报告外不要输出大段解释。',
              '6) 若上下文「合并事实」或 db/crawler 摘要已含某指标/参考范围/左右侧数据，禁止在「风险与不确定性」中声称其缺失；仅当上下文确实无该信息时才写缺失。',
              CODE_AUTHORITY_RULE,
              hasCodeInResults(state?.results)
                ? '【强制】已存在 Code 步骤：报告数字必须全部来自 Code，禁止引用上游裸数或自行推算。'
                : ''
            ]
          : [
              '目标：对输入内容做数据清洗与标准化。',
              '输出要求：',
              '1) 清洗规则列表（去重/字段标准化/缺失值处理）；',
              '2) 清洗后结构化 JSON；',
              '3) 数据质量问题与修复建议。',
              '若上下文含 Code 结果：清洗输出中的关键数字须与 Code 一致，勿用上游裸数覆盖 Code。'
            ]
    const normalizeContext = (input: any) => {
      const scheduledBudget = Number(state?.scheduler?.contextBudget?.[kind] ?? 0)
      const dynamicMax = Number.isFinite(scheduledBudget) && scheduledBudget > 0 ? Math.floor(scheduledBudget * 1.7) : 0
      const maxChars = dynamicMax || (kind === 'report' ? 2600 : kind === 'visualize' ? 2200 : 1800)
      if (typeof input === 'string') {
        const s = input.replace(/\s+/g, ' ').trim()
        return s.length <= maxChars ? s : `${s.slice(0, maxChars)}…`
      }
      if (!input || typeof input !== 'object') return ''
      const trim = (v: any, n: number) => {
        const s = String(v ?? '').replace(/\s+/g, ' ').trim()
        return s.length <= n ? s : `${s.slice(0, n)}…`
      }
      const dep = Array.isArray(input.dependencySummaries) ? input.dependencySummaries : []
      const depLines = dep.slice(0, 5).map((d: any) => {
        const facts = Array.isArray(d?.facts) ? d.facts.slice(0, 5).map((f: any) => `${String(f?.key || '').trim()}:${trim(f?.value, 40)}`).filter(Boolean).join('；') : ''
        const missing = Array.isArray(d?.missingFields) ? d.missingFields.slice(0, 3).join('、') : ''
        return `- ${String(d?.id || '')}(${String(d?.agent || '')}) summary=${trim(d?.summary, 120)}${facts ? ` | facts=${facts}` : ''}${missing ? ` | missing=${missing}` : ''}`
      })
      const globals = Array.isArray(input.globalFacts) ? input.globalFacts : []
      const globalLines = globals.slice(0, 5).map((g: any) => {
        const facts = Array.isArray(g?.facts) ? g.facts.slice(0, 4).map((f: any) => `${String(f?.key || '').trim()}:${trim(f?.value, 36)}`).filter(Boolean).join('；') : ''
        return `- ${String(g?.agent || '')}: ${facts || trim(g?.summary, 120)}`
      })
      const sources = Array.isArray(input.sources) ? input.sources.slice(0, 8).map((x: any) => String(x ?? '').trim()).filter(Boolean) : []
      const blocks = [
        input?.stepQuery ? `当前子任务：${trim(input.stepQuery, 200)}` : '',
        depLines.length ? `依赖摘要：\n${depLines.join('\n')}` : '',
        globalLines.length ? `全局事实：\n${globalLines.join('\n')}` : '',
        sources.length ? `来源：${sources.join('、')}` : '',
        input?.contextDigest ? `上下文摘要：${trim(input.contextDigest, 420)}` : ''
      ].filter(Boolean)
      const merged = blocks.join('\n\n')
      return merged.length <= maxChars ? merged : `${merged.slice(0, maxChars)}…`
    }
    const contextText = normalizeContext(contextInput)

    const prompt = [
      new SystemMessage([`你是${title}（内置于 Manager_Agent）。`, '你只能使用输入中已有的信息，不得编造外部事实。', ...style].join('\n')),
      new HumanMessage([`用户任务：${question}`, contextText ? `上下文结果：\n${contextText}` : '上下文结果：无', '请直接输出最终结果（中文，Markdown）。'].join('\n\n'))
    ]
    const resourcesIn = state.resources
    const resources = extendResourcesDeadlineIfNeeded(resourcesIn, timeLeftMs)
    const effectiveModel = resolveInternalCollaboratorModel(kind, state, resources, opts.openaiModel)
    if (!effectiveModel) throw new Error(`missing model for internal agent: ${kind}`)
    const scheduledTimeoutScale = Number(state?.scheduler?.timeoutScale ?? 1)
    const timeoutScale = Number.isFinite(scheduledTimeoutScale) ? Math.max(0.85, Math.min(1.5, scheduledTimeoutScale)) : 1
    const internalTimeoutMs = resolveInternalAgentTimeoutMs(timeLeftMs, resources, timeoutScale)
    const t0 = Date.now()
    const resp = await traceRun(
      `manager_llm_${kind}`,
      async () => {
        const run = getModel(effectiveModel, 0).invoke(prompt)
        const timeout = new Promise<never>((_r, rej) => {
          setTimeout(() => rej(new Error(`internal ${kind} timeout after ${internalTimeoutMs}ms`)), internalTimeoutMs)
        })
        return (await Promise.race([run, timeout])) as any
      },
      { stage: kind, model: effectiveModel, forceIntent: state.forceIntent, intent: state.intent }
    )
    const outText = String((resp as any)?.content ?? '')
    const usageTokens = extractTotalTokens(resp)
    const tokens = typeof usageTokens === 'number' && usageTokens > 0 ? usageTokens : estimateTokensFromMessages(prompt) + estimateTokensFromText(outText)
    const usd = Number(resources.costPer1kTokensUsd ?? 0) ? (tokens / 1000) * Number(resources.costPer1kTokensUsd ?? 0) : 0
    const nextResources = mergeResources(state, {
      ...(Number(resources.deadlineAtMs ?? 0) !== Number(resourcesIn.deadlineAtMs ?? 0)
        ? { deadlineAtMs: resources.deadlineAtMs }
        : {}),
      usedTokens: Number(resources.usedTokens ?? 0) + tokens,
      usedUsd: Number(resources.usedUsd ?? 0) + usd
    })
    await appendMetrics({ runId: opts.runId, phase: `llm:${kind}`, ms: Date.now() - t0, tokens, usd, model: effectiveModel })
    return { answer: outText.trim(), resources: nextResources, meta: state.meta }
  }

  const runAlwaysInternalCollaborators = async (
    state: any,
    question: string,
    resultsIn: Record<string, string>,
    evidenceIn: any[]
  ) => {
    const collectRagSources = (evidence: any[]) => {
      const out: string[] = []
      for (const e of Array.isArray(evidence) ? evidence : []) {
        if (String(e?.kind || '') !== 'rag') continue
        const citations = Array.isArray(e?.citations) ? e.citations : []
        for (const c of citations) {
          const s = String(c?.source || '').trim()
          if (s) out.push(s)
        }
      }
      return Array.from(new Set(out)).slice(0, 8)
    }
    const collectKnownFacts = (results: Record<string, string>) => {
      const merged = mergeFactsWithCodePriority(results, extractStructuredPayload)
      return merged.slice(0, 24).map((f) => ({ key: f.key, value: f.value }))
    }
    const buildGapFallback = (kind: 'visualize' | 'report', sources: string[], facts: Array<{ key: string; value: any }>, gapMessage: string) => {
      const sourceText = sources.length ? sources.join('、') : '（未返回可引用来源名）'
      const factLines = facts.length ? facts.slice(0, 8).map((f) => `- ${f.key}: ${String(f.value ?? '')}`).join('\n') : '- 暂无可结构化抽取的事实'
      if (kind === 'visualize') {
        return ['### 可视化协作结果（数据不足）', `已检索到文档来源：${sourceText}`, '', '当前事实摘要：', factLines, '', gapMessage].join('\n')
      }
      return ['## 结构化结论（数据不足）', `已检索到文档来源：${sourceText}`, '', '当前事实摘要：', factLines, '', gapMessage].join('\n')
    }

    let nextResults: Record<string, string> = { ...(resultsIn || {}) }
    let nextEvidence: any[] = [...(Array.isArray(evidenceIn) ? evidenceIn : [])]
    let nextResources = state.resources
    let nextMeta = state.meta
    const order: Array<'clean' | 'visualize' | 'report'> = ['clean', 'visualize', 'report']
    const plannedKinds = new Set(Array.isArray(state.plan) ? state.plan.map((s: any) => String(s.agent || '').trim()).filter((a: string) => ['clean', 'visualize', 'report'].includes(a)) : [])
    const allowInternalKinds = state.intent === 'multi' && plannedKinds.size > 0
    for (const kind of order) {
      if (!allowInternalKinds || !plannedKinds.has(kind)) continue
      if (String(nextResults[kind] || '').trim()) continue
      if (!internalAgentEnabled(kind)) continue
      if (
        kind === 'report' &&
        isReportDeferredToSynth(nextResults as Record<string, unknown>, nextEvidence, {
          meta: state.meta,
          planSteps: state.plan
        })
      ) {
        opts.sendEvent({
          event: 'thinking',
          data: '协作增强：叙述性 report 由 Synth 承担（跳过内置 report LLM）',
          from: kind
        })
        continue
      }
      const ragSources = collectRagSources(nextEvidence)
      const knownFacts = collectKnownFacts(nextResults)
      const wantsVisualize = plannedKinds.has('visualize')
      const wantsReport = plannedKinds.has('report')
      const sufficiency = assessDataSufficiencyStructural({
        factsCount: knownFacts.length,
        wantsVisualize: wantsVisualize && kind === 'visualize',
        wantsReport: wantsReport && kind === 'report'
      })
      if ((kind === 'visualize' || kind === 'report') && !sufficiency.sufficient) {
        const fallback = buildGapFallback(kind, ragSources, knownFacts, sufficiency.gapMessage)
        nextResults[kind] = fallback
        const ev = { kind, query: question, mode: 'fast_gap_fallback', sources: ragSources }
        nextEvidence.push(ev)
        opts.sendEvent({ event: 'thinking', data: `协作增强：${kind} 检测到样本不足，启用快速回退`, from: kind })
        emitTrace({ type: 'step_end', agent: kind, status: 'ok', evidence: ev, outputSummary: summarize(fallback), at: new Date().toISOString() })
        continue
      }

      const detKind = kind === 'visualize' || kind === 'report' ? kind : null
      if (detKind && hasCodeInResults(nextResults)) {
        const modelName = resolveInternalCollaboratorModel(kind, state, nextResources, opts.openaiModel)
        const llmModel = modelName ? getModel(modelName) : null
        const auth = await tryCodeAuthorityDownstreamOutput(
          detKind,
          nextResults,
          extractStructuredPayload,
          question,
          llmModel as any,
          { meta: state.meta, planSteps: state.plan }
        )
        if (auth) {
          nextResults[kind] = auth.output
          const ev = { kind, query: question, mode: auth.mode, sources: ragSources }
          nextEvidence.push(ev)
          opts.sendEvent({
            event: 'thinking',
            data:
              auth.mode === 'code_authority_llm'
                ? `协作增强：${kind} 启发模型基于 Code 权威数据生成`
                : `协作增强：${kind} 使用 Code 权威数据确定性生成（跳过 LLM）`,
            from: kind
          })
          emitTrace({
            type: 'step_end',
            agent: kind,
            status: 'ok',
            evidence: ev,
            outputSummary: summarize(auth.output),
            at: new Date().toISOString()
          })
          continue
        }
      }

      const from = kind
      const activeResources = extendResourcesDeadlineIfNeeded(nextResources, timeLeftMs)
      if (Number(activeResources.deadlineAtMs ?? 0) > Number(nextResources.deadlineAtMs ?? 0)) {
        nextResources = mergeResources(state, { deadlineAtMs: activeResources.deadlineAtMs })
        opts.sendEvent({
          event: 'thinking',
          data: `协作增强：为 ${kind} LLM 续展 deadline，避免超时误杀`,
          from: 'manager'
        })
      }
      const contextText = buildInternalCollabContext(nextResults, extractStructuredPayload, kind)
      opts.sendEvent({ event: 'thinking', data: `协作增强：启动 ${kind} 内置协作`, from })
      emitTrace({ type: 'step_start', agent: kind, input: question, at: new Date().toISOString() })
      try {
        const out = await runInternalAgent(kind, question, { ...state, resources: nextResources, meta: nextMeta } as any, contextText)
        const answerText = String(typeof out === 'string' ? out : out.answer)
        nextResults[kind] = answerText
        nextResources = typeof out === 'string' ? nextResources : out.resources
        nextMeta = typeof out === 'string' ? nextMeta : out.meta
        const ev = { kind, query: question, mode: 'always_collab' }
        nextEvidence.push(ev)
        emitTrace({ type: 'step_end', agent: kind, status: 'ok', evidence: ev, outputSummary: summarize(nextResults[kind]), at: new Date().toISOString() })
      } catch (e: any) {
        const err = String(e?.message || e || 'unknown error')
        opts.sendEvent({ event: 'thinking', data: `协作增强：${kind} 执行失败（${err}）`, from })
        emitTrace({ type: 'step_end', agent: kind, status: 'error', error: err, at: new Date().toISOString() })
      }
    }
    return { results: nextResults, evidence: nextEvidence, resources: nextResources, meta: nextMeta }
  }

  return { runInternalAgent, runAlwaysInternalCollaborators }
}
