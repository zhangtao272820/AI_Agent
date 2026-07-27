---
name: failure_recovery
description: 总管失败归因后的修复建议 Playbook。按 FailureAttribution.category 给出 router/planner/execution 等 scope 的可操作修复清单。用于 failureInsights 与运维复盘。
version: 1.0.0
stage: fix
owner: manager_agent
---

# 失败修复 Playbook

> **SSOT**：与 `managerGraph.failureFixSuggestions.ts` 中 `buildFixSuggestions()` 逻辑对应。  
> 运行时仍由 TS 生成结构化建议；本文档供审计、晋级与 prompt_evolution 合并。

## 全局兜底

当 `failure.category !== 'success'` 且 `routeConfidence < 0.35` 时，**优先插入**（unshift）：

| scope | priority | title | action | hints |
|-------|----------|-------|--------|-------|
| router | high | 优先触发澄清或保守路由 | 在极低路由置信度下，不要强行多路并发，先澄清或保守执行。 | routeConfidence≈{value} |

每条 category 最多返回 **4** 条建议（`suggestions.slice(0, 4)`）。

---

## clarify_needed

| scope | priority | title | action | hints |
|-------|----------|-------|--------|-------|
| router | high | 强化澄清判定 | 当时间范围、对象标识、任务类型缺失时，优先触发澄清而不是继续编排。 | 补齐时间范围 / 对象 / 输出格式三个关键槽位；澄清问题限制在 1-3 个，避免过度追问 |
| planner | medium | 规划前先补关键约束 | 在生成 plan 前，把缺失约束显式写入 routedQuery，降低下游误拆解。 | 把缺失字段写入 query constraints；让 planner 看到「缺什么」，而不是只看到原始问句 |

---

## route_error

| scope | priority | title | action | hints |
|-------|----------|-------|--------|-------|
| router | high | 提高路由置信度门槛 | 当 routeConfidence 偏低且多次命中失败样本时，提升澄清阈值或切换保守路由。 | 当前 routeConfidence≈{value}；优先复用相似成功样本，降低启发式拍脑袋分配 |
| memory | medium | 引入负样本路由提示 | 把高频失败场景写入负样本提示，避免下一次继续走错误路径。 | 取自 failure.reasons 前 3 条 |

---

## plan_error

| scope | priority | title | action | hints |
|-------|----------|-------|--------|-------|
| planner | high | 收紧计划步数与粒度 | 把同类数据源合并检索，拆分必须可独立执行，避免过细或过重的 plan。 | 每一步 query 保持极简且可独立执行；避免同源重复 agent 和重复事实抽取 |
| policy | medium | 对规则兜底做提示修正 | 将近期规划失败模式转成 planner hint，优先减少 rule fallback。 | 观察 plan_outcome 中的 ruleFallback 比例；对高频场景做模板化步骤 |

---

## tool_failure

| scope | priority | title | action | hints |
|-------|----------|-------|--------|-------|
| execution | high | 增加工具降级与绕过 | 对常失败工具启用临时降级、重试退避或直接切换到备选工具。 | 取自 context.toolNames 前 4 个 |
| policy | medium | 记录工具健康并联动调度 | 把失败工具状态写入健康面板，让 scheduler 自动降权。 | 统计 timeout / error / denial；为失败工具增加 circuit open 逻辑 |

---

## evidence_gap

| scope | priority | title | action | hints |
|-------|----------|-------|--------|-------|
| planner | high | 先证据后结论 | 先补 evidence 再总结，必要时先走 probe / retrieval / crawler。 | 让计划显式包含 evidence acquisition step；finalize 前检查 evidenceKinds 是否为空 |
| router | medium | 提升数据基础意识 | 当结果存在但 evidence 为空时，优先改为检索型任务而不是直接汇总。 | 已有部分证据但不充分 / 当前几乎没有证据支撑（依 hasEvidence 二选一） |

---

## search_gap

| scope | priority | title | action | hints |
|-------|----------|-------|--------|-------|
| router | high | 联网检索补全或澄清 | SERP 无命中时优先补搜、换 query，或向用户确认检索范围。 | 检查 TAVILY_API_KEY / SERPER_API_KEY 是否配置；启用 MANAGER_SEARCH_LOOP 做多轮补搜；failure.reasons 前 3 条 |
| execution | medium | 下沉 seed 到 crawler | 确保 seed_urls / serp_context 传入 Extractor，减少 Bing 盲搜。 | 确认 Extractor /api/health 可用；对实时问题保持 needsWebSearch=true |

---

## synthesis_error

| scope | priority | title | action | hints |
|-------|----------|-------|--------|-------|
| synthesizer | high | 缩短汇总输入并结构化输出 | 把子 Agent 原文压缩为事实块，避免 synth 在长文本中丢失主结论。 | 优先展示结论、关键数据、行动建议；把 report / visualize / multimodal 结果分块喂给 synth |
| verifier | medium | 增加最终答案完整性检查 | 如果已有结果但 final 为空，触发补写或重试，而不是直接放行。 | current finalConfidence≈{value} |

---

## verification_gap

| scope | priority | title | action | hints |
|-------|----------|-------|--------|-------|
| verifier | medium | 让校验器先看 evidence 再看结论 | 当 evidence 已存在但结果未落地时，优先补齐执行路径。 | 增加「有 evidence 但无结果」分支；避免把无输出误判为成功 |
| execution | medium | 在执行端补强返回约束 | 要求子 Agent 至少返回结构化摘要或失败原因。 | 统一每个 agent 的最小输出协议 |

---

## policy_boundary

| scope | priority | title | action | hints |
|-------|----------|-------|--------|-------|
| policy | high | 把边界任务前置拦截 | 对越权、无权限或能力边界任务直接走边界解释，不进入全量执行。 | 明确 capabilityOk=false 的触发条件；不要让下游 agent 空转 |
| router | medium | 边界提示更早给出 | 在路由阶段直接说明不可做范围，并给出可替代方案。 | failure.reasons 前 2 条 |

---

## timeout

| scope | priority | title | action | hints |
|-------|----------|-------|--------|-------|
| policy | high | 压缩路径与上下文预算 | 减少多余 agent，缩短 prompt，提前结束低价值分支。 | 降低 maxParallel 或切换 serial；对长任务先做粗分层再逐层展开 |
| execution | medium | 对慢工具启用分级超时 | 给慢工具设置更严格的超时和重试上限，减少整体拖死。 | 按 agent 维护 timeoutScale；对接近 deadline 的 run 进入 low-cost mode |

---

## default（未分类 / 其它）

| scope | priority | title | action | hints |
|-------|----------|-------|--------|-------|
| memory | low | 记录该失败为新样本 | 把本次失败样本保留到经验库中，等待相似场景复用。 | failure.reasons |
| policy | low | 持续观察是否有重复模式 | 如果同类失败持续出现，再升级为自动策略补丁。 | 监控同类 failureCategory 的聚集度 |
