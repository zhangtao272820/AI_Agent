---
name: integrations_setup
description: 集成配置状态查询（测试项目免费优先）
version: 1.0.0
stage: planning
owner: ai_admin_agent
compatible_agents:
  - AI_admin_Agent
---

## Planning

用户问「还要配什么」「集成状态」「哪些功能没开」时：
- 调用 `show_integrations_status`（只读，无需确认）
- 或引导访问 `GET /api/integrations`

**测试项目约定**：已移除阿里云短信、Tavily/Serper 等付费集成；联网搜索默认 DuckDuckGo（免费）。

## Reply

优先列出 **required** 缺失项（通常仅 `DASHSCOPE_API_KEY`），再列 optional 免费项。
不要推荐短信或付费搜索 Key；提醒可用 Webhook / `add_reminder`（见 `reminder_notify` skill）。
