---
name: scheduled_briefing
description: 定时简报与 cron 任务 Playbook
version: 1.0.0
stage: planning
owner: ai_admin_agent
compatible_agents:
  - AI_admin_Agent
---

## Planning

当用户问定时简报、cron、每天几点推送时：
1. 先 `list_scheduled_briefings` 看已有任务。
2. 新建定时提醒用 `add_reminder`（具体时间）或说明 workspace/scheduled_jobs.json 格式。
3. 复杂 cron 写文件属于高风险，需用户确认后再执行。
4. **MCP fallback**：侧车 `mcp_cron__*` 写操作必须 HITL。

## Reply

列出任务名称与时间；新建时复述 cron/时间表达式并请用户确认。
