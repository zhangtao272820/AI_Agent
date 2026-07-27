---
name: ask_database
description: DB_Agent 问数 Playbook
version: 1.0.0
stage: planning
owner: ai_admin_agent
compatible_agents:
  - AI_admin_Agent
---

## Planning

当用户要查业务数据、统计、报表、「有多少条」：
1. **优先**调用 `ask_database`，`question` 填用户原话或精炼后的中文问句。
2. 不要猜测 SQL；交给 DB_Agent 安全 SELECT。
3. DB 未配置时提示设置 `DB_AGENT_HTTP_URL`，不要编造数字。
4. 若需把结果记笔记，用户确认后再 `add_note`。

## Reply

- 直接给出数据结论与关键数字
- 注明「数据来自业务库问数」即可，勿贴 SQL/表名
- 若需澄清维度（时间范围、口径），转述 DB 返回的澄清问题
