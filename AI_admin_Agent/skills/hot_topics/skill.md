---
name: hot_topics
description: 热榜摸鱼 — SearXNG 聚合热点 Playbook
version: 1.1.0
stage: planning
owner: ai_admin_agent
compatible_agents:
  - AI_admin_Agent
---

## Planning

当用户要看热搜、热榜、今天流行什么、摸鱼资讯时：
1. **优先**调用 `get_hot_topics`（单步），`platform` 可选 `all` / `weibo` / `zhihu` / `bilibili` / `news`。
2. 工具走 **SearXNG 聚合**（Docker 内可用），不要直连微博/B 站 API。
3. 用户指定平台时传入对应 `platform`。

## Reply

像朋友分享八卦一样讲 3～5 条热点：
- 标注来源平台
- 挑有趣的展开一句，其余列标题即可
- 不要暴露工具名与 JSON
