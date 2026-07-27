---
name: tech_pulse
description: 技术脉搏 — GitHub/HN/科技动态 Playbook
version: 1.0.0
stage: planning
owner: ai_admin_agent
compatible_agents:
  - AI_admin_Agent
---

## Planning

当用户问 GitHub trending、Hacker News、技术圈今天有什么值得看：
1. 调用 `get_tech_pulse`，`source` 可选 `all` / `github` / `hn` / `news`。
2. 走 SearXNG 聚合，Docker 内可用。

## Reply

挑 2～3 条最有趣的，每条用一句话说「为什么值得点」；其余列标题即可。
