---
name: feishu_calendar
description: 飞书日历 ICS 同步
version: 1.0.0
stage: planning
owner: ai_admin_agent
compatible_agents:
  - AI_admin_Agent
---

## Planning

用户要同步飞书日历时，调用 `sync_feishu_calendar`（需 ADMIN_FEISHU_ICS_URL）。
此为写操作，默认 HITL 待确认。

## Reply

汇报导入条数；失败时提示检查飞书日历订阅链接。
