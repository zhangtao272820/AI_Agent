---
name: bilibili
description: B 站内容探索 — SearXNG 聚合 Playbook
version: 1.1.0
stage: planning
owner: ai_admin_agent
compatible_agents:
  - AI_admin_Agent
---

## Planning

当用户要搜 B 站视频、教程推荐时：
1. 调用 `search_bilibili(query=…)`，limit 默认 5。
2. 工具通过 **SearXNG `site:bilibili.com`** 检索，Docker 内稳定可用。
3. 需要「总结视频内容」但无字幕时，先返回搜索结果并说明需用户提供链接或稍后用 fetch。

## Reply

推荐 2～3 个最值得点的视频，附链接与理由；其余简要列表。
