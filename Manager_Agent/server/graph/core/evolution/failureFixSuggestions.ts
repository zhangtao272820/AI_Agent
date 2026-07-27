/**
 * 失败修复建议生成器。
 * SSOT 文档：skills/failure_recovery/skill.md（Phase A 已外提；运行时逻辑仍以本文件为准）。
 */
import type { FailureAttribution } from './failureAttribution'

export type FixSuggestion = {
  title: string
  action: string
  priority: 'high' | 'medium' | 'low'
  scope: 'router' | 'planner' | 'execution' | 'synthesizer' | 'verifier' | 'policy' | 'memory'
  hints: string[]
}

export type FixSuggestionBundle = {
  category: FailureAttribution['category']
  severity: FailureAttribution['severity']
  suggestions: FixSuggestion[]
}

function uniq(arr: string[]) {
  return Array.from(new Set(arr.map((x) => String(x || '').trim()).filter(Boolean)))
}

function mk(
  scope: FixSuggestion['scope'],
  title: string,
  action: string,
  priority: FixSuggestion['priority'],
  hints: string[] = []
): FixSuggestion {
  return { scope, title, action, priority, hints: uniq(hints).slice(0, 5) }
}

export function buildFixSuggestions(failure: FailureAttribution, context?: { routeConfidence?: number; finalConfidence?: number; hasEvidence?: boolean; toolNames?: string[] }): FixSuggestionBundle {
  const reasons = uniq(failure.reasons)
  const routeConf = Number(context?.routeConfidence ?? 0)
  const finalConf = Number(context?.finalConfidence ?? 0)
  const hasEvidence = Boolean(context?.hasEvidence)
  const toolNames = uniq(context?.toolNames ?? [])
  const suggestions: FixSuggestion[] = []

  switch (failure.category) {
    case 'clarify_needed':
      suggestions.push(
        mk('router', '强化澄清判定', '当时间范围、对象标识、任务类型缺失时，优先触发澄清而不是继续编排。', 'high', [
          '补齐时间范围 / 对象 / 输出格式三个关键槽位',
          '澄清问题限制在 1-3 个，避免过度追问'
        ]),
        mk('planner', '规划前先补关键约束', '在生成 plan 前，把缺失约束显式写入 routedQuery，降低下游误拆解。', 'medium', [
          '把缺失字段写入 query constraints',
          '让 planner 看到“缺什么”，而不是只看到原始问句'
        ])
      )
      break
    case 'route_error':
      suggestions.push(
        mk('router', '提高路由置信度门槛', '当 routeConfidence 偏低且多次命中失败样本时，提升澄清阈值或切换保守路由。', 'high', [
          `当前 routeConfidence≈${routeConf.toFixed(2)}`,
          '优先复用相似成功样本，降低启发式拍脑袋分配'
        ]),
        mk('memory', '引入负样本路由提示', '把高频失败场景写入负样本提示，避免下一次继续走错误路径。', 'medium', [
          ...reasons.slice(0, 3)
        ])
      )
      break
    case 'plan_error':
      suggestions.push(
        mk('planner', '收紧计划步数与粒度', '把同类数据源合并检索，拆分必须可独立执行，避免过细或过重的 plan。', 'high', [
          '每一步 query 保持极简且可独立执行',
          '避免同源重复 agent 和重复事实抽取'
        ]),
        mk('policy', '对规则兜底做提示修正', '将近期规划失败模式转成 planner hint，优先减少 rule fallback。', 'medium', [
          '观察 plan_outcome 中的 ruleFallback 比例',
          '对高频场景做模板化步骤'
        ])
      )
      break
    case 'tool_failure':
      suggestions.push(
        mk('execution', '增加工具降级与绕过', '对常失败工具启用临时降级、重试退避或直接切换到备选工具。', 'high', [
          ...toolNames.slice(0, 4)
        ]),
        mk('policy', '记录工具健康并联动调度', '把失败工具状态写入健康面板，让 scheduler 自动降权。', 'medium', [
          '统计 timeout / error / denial',
          '为失败工具增加 circuit open 逻辑'
        ])
      )
      break
    case 'evidence_gap':
      suggestions.push(
        mk('planner', '先证据后结论', '先补 evidence 再总结，必要时先走 probe / retrieval / crawler。', 'high', [
          '让计划显式包含 evidence acquisition step',
          'finalize 前检查 evidenceKinds 是否为空'
        ]),
        mk('router', '提升数据基础意识', '当结果存在但 evidence 为空时，优先改为检索型任务而不是直接汇总。', 'medium', [
          hasEvidence ? '已有部分证据但不充分' : '当前几乎没有证据支撑'
        ])
      )
      break
    case 'search_gap':
      suggestions.push(
        mk('router', '联网检索补全或澄清', 'SERP 无命中时优先补搜、换 query，或向用户确认检索范围。', 'high', [
          '检查 SEARXNG_BASE_URL 或 TAVILY/SERPER API Key 是否配置',
          '启用 MANAGER_SEARCH_LOOP 做多轮补搜',
          ...reasons.slice(0, 3)
        ]),
        mk('execution', '下沉 seed 到 crawler', '确保 seed_urls / serp_context 传入 Extractor，减少 Bing 盲搜。', 'medium', [
          '确认 Extractor /api/health 可用',
          '对实时问题保持 needsWebSearch=true'
        ])
      )
      break
    case 'synthesis_error':
      suggestions.push(
        mk('synthesizer', '缩短汇总输入并结构化输出', '把子 Agent 原文压缩为事实块，避免 synth 在长文本中丢失主结论。', 'high', [
          '优先展示结论、关键数据、行动建议',
          '把 report / visualize / multimodal 结果分块喂给 synth'
        ]),
        mk('verifier', '增加最终答案完整性检查', '如果已有结果但 final 为空，触发补写或重试，而不是直接放行。', 'medium', [
          `current finalConfidence≈${finalConf.toFixed(2)}`
        ])
      )
      break
    case 'verification_gap':
      suggestions.push(
        mk('verifier', '让校验器先看 evidence 再看结论', '当 evidence 已存在但结果未落地时，优先补齐执行路径。', 'medium', [
          '增加“有 evidence 但无结果”分支',
          '避免把无输出误判为成功'
        ]),
        mk('execution', '在执行端补强返回约束', '要求子 Agent 至少返回结构化摘要或失败原因。', 'medium', [
          '统一每个 agent 的最小输出协议'
        ])
      )
      break
    case 'policy_boundary':
      suggestions.push(
        mk('policy', '把边界任务前置拦截', '对越权、无权限或能力边界任务直接走边界解释，不进入全量执行。', 'high', [
          '明确 capabilityOk=false 的触发条件',
          '不要让下游 agent 空转'
        ]),
        mk('router', '边界提示更早给出', '在路由阶段直接说明不可做范围，并给出可替代方案。', 'medium', [
          ...reasons.slice(0, 2)
        ])
      )
      break
    case 'timeout':
      suggestions.push(
        mk('policy', '压缩路径与上下文预算', '减少多余 agent，缩短 prompt，提前结束低价值分支。', 'high', [
          '降低 maxParallel 或切换 serial',
          '对长任务先做粗分层再逐层展开'
        ]),
        mk('execution', '对慢工具启用分级超时', '给慢工具设置更严格的超时和重试上限，减少整体拖死。', 'medium', [
          '按 agent 维护 timeoutScale',
          '对接近 deadline 的 run 进入 low-cost mode'
        ])
      )
      break
    default:
      suggestions.push(
        mk('memory', '记录该失败为新样本', '把本次失败样本保留到经验库中，等待相似场景复用。', 'low', reasons),
        mk('policy', '持续观察是否有重复模式', '如果同类失败持续出现，再升级为自动策略补丁。', 'low', [
          '监控同类 failureCategory 的聚集度'
        ])
      )
  }

  if (failure.category !== 'success' && routeConf < 0.35) {
    suggestions.unshift(
      mk('router', '优先触发澄清或保守路由', '在极低路由置信度下，不要强行多路并发，先澄清或保守执行。', 'high', [
        `routeConfidence≈${routeConf.toFixed(2)}`
      ])
    )
  }

  return {
    category: failure.category,
    severity: failure.severity,
    suggestions: suggestions.slice(0, 4)
  }
}
