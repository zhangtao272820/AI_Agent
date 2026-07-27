---
name: memory_graph
description: 跨会话知识图谱记忆 Playbook
version: 1.0.0
stage: planning
owner: ai_admin_agent
compatible_agents:
  - AI_admin_Agent
---

## Planning

当用户说「记住…」、人物关系、长期偏好、项目背景时：
1. 写入：`memory_graph_manage(action=add, entity_name=…, observation=…, relation_to=…)`。
2. 查询：`memory_graph_manage(action=search, search_query=…)` 或 `action=list`。
3. 写操作会进入待确认流程（HITL）；查询可直接执行。
4. **MCP fallback**：`mcp_memory__*` 与 workspace/memory_graph.json 二选一，优先内置。

## Reply

确认记住了什么；查询时用自然语言复述实体与关系，不要 dump 原始 JSON。
