---
name: feishu_notify
description: 飞书群机器人通知
version: 1.0.0
stage: planning
owner: ai_admin_agent
compatible_agents:
  - AI_admin_Agent
---

## Planning

用户要通过飞书发消息时，调用 `send_feishu_message`（需 ADMIN_FEISHU_WEBHOOK_URL）。
此为对外发送，默认 HITL 待确认。

## Reply

成功则简短确认；未配置时提示去飞书群设置添加自定义机器人并复制 Webhook。
