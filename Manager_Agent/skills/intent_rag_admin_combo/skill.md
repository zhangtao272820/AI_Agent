---
name: intent_rag_admin_combo
description: 用户并列要求知识库检索与办公事务（日程/待办/邮件）
version: 1.0.0
stage: curated
owner: manager
---

## When

用户**同一句**里既有知识库/文档检索，又有创建会议、日程、待办、提醒：

> 检索个人月度财务情况，并帮我创建明天上午 10 点的项目周会
> 查知识库制度要点，同时添加待办提醒

## Success path

- source=curated_intent_playbook
- intent=multi
- 执行路径：`rag→admin`（两步；admin 无写操作确认时由写闸拦截）
- 禁止：未经用户要求插入 code/report/visualize/crawler

## Example

```
Q: 在知识库中检索个人月度财务情况，并创建明天 10 点会议提醒
路径: rag → admin
```

## Review

- [x] 仅当用户**本轮**明确提到 admin 诉求；勿从历史会话带入
