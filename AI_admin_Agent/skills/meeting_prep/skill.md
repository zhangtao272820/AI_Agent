---
name: meeting_prep
description: 会前准备 Playbook（日程 + RAG + 备忘）
version: 1.0.0
stage: planning
owner: ai_admin_agent
compatible_agents:
  - AI_admin_Agent
---

## Planning

当用户说「会前准备 / 会议材料 / 明天开会准备」：
1. **优先**调用 `prepare_meeting`，传入用户原话作为 `query`。
2. 若用户给出会议名，可填 `event_title`。
3. 需要写入备忘时，再调用 `add_note`（高风险写操作，默认不自动执行）。
4. 知识库无结果时，诚实说明并建议用户提供议题关键词。

## Reply

结构：会议时间与主题 → 知识库要点（若有）→ 建议讨论清单（3～5 条）。
语气专业简洁，适合国内职场。
