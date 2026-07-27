---
name: intent_rag_finance_chart
description: 用户明确要求从知识库取数并生成图表/可视化时；rag→code→visualize
version: 1.0.0
stage: curated
owner: manager
---

## When

用户**同时**提到知识库/文档取数 **且** 明确要求图表、可视化、对比图、ECharts：

> 从知识库取财务数据画对比图
> 检索知识库月度收支并生成柱状图
> 根据文档里的收入支出做成可视化

## Success path

- source=curated_intent_playbook
- intent=multi（或 rag + 显式下游）
- 执行路径：`rag→code→visualize`
- 硬规则：visualize 须有 code；**有 code 时须 clean**（单源 rag 也须清洗后再计算）
- 仅当用户还要「分析报告/结论报告」时才加 report

## Example

```
Q: 从知识库取个人月度财务数据，生成收支对比柱状图
路径: rag → code → visualize
```

## Review

- [x] 须用户显式要图表，勿把「查询财务状况」误判为本技能
