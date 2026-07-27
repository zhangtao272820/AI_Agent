---
name: reminder_notify
description: 免费提醒替代（不用短信）
version: 1.0.0
stage: planning
owner: ai_admin_agent
compatible_agents:
  - AI_admin_Agent
---

## Planning

用户要「短信提醒」「手机通知」时，**不要**调用已移除的短信工具。按优先级：

1. **本地提醒**：`add_reminder`（桌面/调度器，无需外部账号）
2. **协作群通知（免费 Webhook）**：`send_team_notification` 或 `send_feishu_message` / `send_dingtalk_message` / `send_wecom_message`
3. 若均未配置，说明测试项目已禁用付费短信，建议配置飞书/企微/钉钉群机器人 Webhook

## Reply

明确告知未使用短信；说明实际使用的提醒通道。
