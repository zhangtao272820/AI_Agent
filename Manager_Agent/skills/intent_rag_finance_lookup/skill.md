---
name: intent_rag_finance_lookup
description: 纯知识库月度/个人财务指标查询；单步 rag，禁止扩写 report/code/crawler/admin
version: 1.0.0
stage: curated
owner: manager
---

## When

用户**仅**从知识库/文档查询个人或月度财务情况（收入、支出、结余、公积金、社保等），**未**要求图表、报告、联网检索或创建日程：

> 在知识库中查询我的月度财务状况
> 从知识库查个人月度收入支出
> 知识库里我的财务情况怎么样

## Success path

- source=curated_intent_playbook
- intent=rag；planShortcut=rag_only
- 执行路径：`rag`
- 禁止：因历史相似问句自动追加 clean/code/report/crawler/admin

## Example

```
Q: 在知识库中查询我的月度财务状况
路径: rag → synth（直接汇总检索事实，勿改道 db）
```

## Review

- [x] 与 MANAGER_INTENT_PLAYBOOK.rag_finance_kb 对齐
- [x] 用户末轮原话优先；相似 ≠ 同一任务
