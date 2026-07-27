---
name: random_wiki
description: 百科盲盒 — 冷知识 Playbook
version: 1.0.0
stage: planning
owner: ai_admin_agent
compatible_agents:
  - AI_admin_Agent
---

## Planning

当用户要冷知识、百科盲盒、随机涨见识、开盒时：
1. 调用 `random_wiki_trivia`（单步）。
2. 维基不可达时工具有本地精选兜底，照常回复。

## Reply

用「哇，你知道吗」的朋友语气讲 1 条知识，附一句延伸联想；若有链接可提示「想深挖可以点开」。
