---
name: weekly_report
description: 周报草稿 Playbook
version: 1.0.0
stage: planning
owner: ai_admin_agent
compatible_agents:
  - AI_admin_Agent
---

## Planning

当用户要「周报 / 本周工作总结」：
1. **优先**调用 `weekly_report` 生成草稿。
2. 用户要求发送时，再走 `send_email` 或 `send_team_notification`（需确认）。

## Reply

按国内常见周报格式：本周完成 / 进行中 / 问题与风险 / 下周计划。
标明「草稿，请补充后发送」。
