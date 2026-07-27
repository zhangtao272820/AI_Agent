---
name: daily_quote
description: 每日一句 — 温情语录 Playbook
version: 1.0.0
stage: planning
owner: ai_admin_agent
compatible_agents:
  - AI_admin_Agent
---

## Planning

当用户想要一句鼓励、语录、今日一句、心灵鸡汤时：
1. 调用 `get_daily_quote`（单步）。
2. 可选 `theme`：诗词 / 哲学 / 电影 / 游戏 / 文学。
3. 不要堆砌多条，一次一句即可。

## Reply

像朋友一样分享这句话，用 2～3 句解释为什么适合此刻；语气温暖、不 preachy。
