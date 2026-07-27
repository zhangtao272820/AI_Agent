---
name: calendar_multi
description: 多日历 ICS 批量同步
version: 1.0.0
stage: planning
owner: ai_admin_agent
compatible_agents:
  - AI_admin_Agent
---

## Planning

用户要同步多个日历（飞书+钉钉+Outlook 等 ICS）时，调用 `sync_all_calendars`。
配置 `ADMIN_CALENDAR_SUBSCRIPTIONS` JSON，或至少 `ADMIN_FEISHU_ICS_URL`。
写操作，默认 HITL 待确认。

## Reply

按日历源汇报导入条数；部分失败时列出失败源并建议检查 ICS 链接。
