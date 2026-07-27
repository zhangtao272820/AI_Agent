---
name: intent_rag_doc_norm_lookup
description: 从知识库检索制度/规范/手册中的条款与数值；单步 rag
version: 1.0.0
stage: curated
owner: manager
---

## When

用户从知识库/文档检索**制度、规范、手册、配比要求**等事实，**未**要求图表或报告：

> 从知识库 [制度类文档] 中提取 [合规指标] 要求
> 手册里 [某类对象] 的 [比例/配比] 是多少
> 检索制度文档中的指标定义

## Success path

- source=curated_intent_playbook
- intent=rag；planShortcut=rag_only
- 执行路径：`rag`
- 禁止：单条规范检索扩成 rag→code→visualize→report

## Example

```
Q: 从知识库 [规范文档] 中提取 [人群分类] 的 [配比指标] 要求
路径: rag → synth
```

## Review

- [x] 与 rag_doc_qa / rag_lookup_values 同类；仅显式要图表时才走 chart 技能
