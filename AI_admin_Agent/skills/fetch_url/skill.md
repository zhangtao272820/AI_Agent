---
name: fetch_url
description: 网页链接精读 Playbook
version: 1.0.0
stage: planning
owner: ai_admin_agent
compatible_agents:
  - AI_admin_Agent
---

## Planning

当用户贴链接、要精读/总结网页时：
1. **优先** `fetch_url_content(url=…)` 抓正文。
2. 若失败再 `web_search` 找镜像或相关报道。
3. 不要假设链接内容；必须以工具返回为准。
4. **MCP fallback**：侧车 `mcp_fetch__*` 与内置等价，优先内置。

## Reply

结构化摘要：主题、要点 3～5 条、来源 URL；过长正文只总结不全文粘贴。
