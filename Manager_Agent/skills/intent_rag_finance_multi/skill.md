---
name: intent_rag_finance_multi
description: 用户并列要求知识库财务检索 + 联网指标 + 报告/图表等多阶段任务
version: 1.0.0
stage: curated
owner: manager
---

## When

用户**明确列出多个子目标**，例如：知识库取数 **且** 公开网站检索 **且** 对比分析/报告/图表：

> 从知识库提取月度收支，再从权威网站查储蓄率对照区间，写分析报告
> 知识库财务数据 + 联网查家庭财务健康指标 + 生成图表和结论

## Success path

- source=curated_intent_playbook
- intent=multi
- 典型路径：`rag→crawler→code→report` 或 `rag→crawler→code→visualize→report`（按用户显式子句）
- 多源取数时方可加 clean；勿对「仅查知识库」套本模板

## Example

```
Q: 从知识库提取月收入月支出，联网查储蓄率对照区间，对比分析并写报告
路径: rag ∥ crawler → clean → code → report
```

## Review

- [x] 禁止将「在知识库中查询我的月度财务状况」套用到本技能
