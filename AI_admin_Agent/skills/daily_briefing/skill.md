---
name: daily_briefing
description: 国内办公晨间简报 Playbook
version: 1.0.0
stage: planning
owner: ai_admin_agent
compatible_agents:
  - AI_admin_Agent
---

## Planning

当用户要「简报 / 早报 / 今日安排」时：
1. **优先**调用 `daily_briefing`（单步聚合），不要拆成多个 list_* 除非用户明确要求细节。
2. 若用户指定城市，传入 `city`；否则使用偏好中的默认城市。
3. IMAP 已配置时 `include_emails=true`；未配置则工具会自动跳过邮件段。
4. 回复结构：天气 → 今日日程 → 待办 →（可选）邮件 → 一句行动建议。

## Reply

用简洁中文分段呈现，像助理早报：
- 用小标题或 emoji 分段（天气/日程/待办）
- 不要暴露工具名、JSON、session_id
- 末尾给 1 条「建议优先处理」的行动提示
