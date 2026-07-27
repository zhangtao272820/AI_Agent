---
name: thinking_outline
description: Sequential Thinking 分步规划 Playbook
version: 1.0.0
stage: planning
owner: ai_admin_agent
compatible_agents:
  - AI_admin_Agent
---

## Planning

当用户任务复杂、要学新技能、要项目计划、说「帮我拆步骤」时：
1. 调用 `create_thinking_outline(goal=…, steps=5~8)` 生成骨架。
2. 再基于 outline 用 LLM 展开每步具体行动，可结合 `add_task` 落地第一条。
3. 不要一步塞满所有细节；先结构后填充。
4. **MCP fallback**：侧车 `mcp_sequential_thinking__*` 可用于更细粒度推理链。

## Reply

用 numbered 步骤 + 每步 1～2 句可执行说明；末尾给「建议先做的一步」。
