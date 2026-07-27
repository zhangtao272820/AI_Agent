---
name: admin_capabilities
description: 总管侧个人助理（admin）能力：邮件、联系人、待办、日程、天气、高德出行、飞书发消息。搜索/玩法/问数等走总管其他 Agent。
version: 1.2.0
stage: route
owner: manager_agent
compatible_agents:
  - Manager_Agent
  - AI_admin_Agent
---

## Capabilities（总管路由范围 · 仅此七类）

总管 `allowedAgents` 含 `admin` 时，**只**处理下列诉求。AI_admin_Agent 本体可有更多工具，但 **Manager 路由与 Planner 不得**将其他能力判给 admin。

| 类别 | 用户诉求示例 | 说明 |
|------|-------------|------|
| **邮件** | 发信、收件箱、分拣、回信 | `send_email`、`list_emails`、`triage_emails`… |
| **联系人** | 添加/查询通讯录 | `add_contact`、`search_contact`、`list_contacts`… |
| **待办** | 创建待办、列出、完成 | `add_task`、`add_task_with_due`、`list_tasks`… |
| **日程** | 会议、日历、提醒 | 会议/日程须 `add_event`（落库）；纯闹钟/叫我可用 `add_reminder` |
| **天气** | 今天气温、预报、下雨、穿衣 | `get_weather`；**禁止** crawler 爬天气网页 |
| **地图** | 多久到、怎么走、周边 POI、地址解析 | `get_travel_route`、`search_*_amap` 等 |
| **飞书** | 发飞书消息 | `send_feishu_message` |

## 总管禁止经 admin 路由的能力

以下能力在 AI_admin 玩法台/MCP 可用，但 **总管不加 cap、不写 admin 步骤**：

- 热榜 / B 站 / arxiv / 每日一句 / 百科盲盒 → **总管不编排**（用户直连 Admin 玩法台）
- 联网搜索 / 知识库检索 / 问数 → **总管** crawler / rag / db（勿进 admin）
- 简报 / 会前准备 / 文件 / 笔记 / 长期记忆 / 企微钉钉 / 浏览器自动化 → **总管不编排 admin**；跨轮 recall 由 Manager **内置 `memory` Agent** 承接

## RouteHints

- 纯邮件 / 联系人 / 待办 / 日程 / 天气 / 地图 / 飞书 → `allowedAgents: ["admin"]`，intent=admin。
- 复合任务：取数走 db/rag/crawler，办公子句走 admin；admin query **只写**对应子句。
- **不要**把纯路线/地图/天气判给 code、crawler、rag。
- **不要**把搜索、问数、arxiv、热榜、记忆等判给 admin（总管侧）。

## PlannerHints

- admin 步骤 query 只写上述七类子任务，保留用户原话中的地点、时间、起终点、收件人。
- 会议/「创建日程」必须规划 `add_event`，禁止只用 `add_reminder`（日历页读不到）。
- 地图子任务默认**无需** dependsOn rag/db/crawler，除非用户明确「根据查询结果再出行」。
