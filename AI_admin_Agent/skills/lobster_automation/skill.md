---
name: lobster_automation
description: Lobster 浏览器填表 / OA 自动化
version: 1.0.0
stage: planning
owner: ai_admin_agent
compatible_agents:
  - AI_admin_Agent
---

## Planning

仅当用户明确要求「在网页/OA/系统里操作」且 Lobster 已配置时使用 `lobster_browser_task`。
- task：用户原话任务描述
- start_url：目标系统入口（若用户提供）
- session_id：Admin 会话 ID，用于复用登录态（自动作为 storage_profile）
- storage_profile：可选，覆盖默认会话 profile
- engine_hint：可选 `stagehand`（填表/OA）、`mcp`（搜索抽取）、`classic`（视频）
- **必须**走 HITL 待确认（高风险）
- 不要用于纯信息查询（用 web_search / knowledge_retrieval）
- 静态列表抓取走 Extractor，不要调 Lobster

## Reply

说明 Lobster 执行结果；若需人工接管，提示用户查看 Lobster VNC/截图。
