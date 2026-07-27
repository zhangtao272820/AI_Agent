---
name: crawler_web
description: 爬虫 Agent（crawler = Extractor_Agent）路由与规划：使用前必须先经总管联网搜索增强，禁止单独调用；与 gui 严格拆分。
version: 1.0.0
stage: route,planner
owner: manager_agent
compatible_agents:
  - Manager_Agent
  - Extractor_Agent
---

## 定位

- 规划 id：**`crawler`**（爬虫 Agent）。
- 后端服务：**Extractor_Agent**（同一能力，不另立 extract id）。
- 与 **gui（Lobster）** 是同级、不同职责的两个 Agent。

| 维度 | 爬虫 `crawler` | GUI `gui` |
|------|----------------|-----------|
| 后端 | Extractor_Agent | Lobster_Agent |
| 动作 | URL → 结构化正文/列表 | 浏览器点击、填表、登录 |
| 联网 | **必须先**经总管 `web_search` 增强 | 通常直接操作目标站 |
| 禁止 | **单独调用**（无 SERP 不得调爬虫） | 替代爬虫做静态批量抽取 |

SSOT：`Manager_Agent/doc/内部协作与子Agent能力升级.md`。

## Route

### 何时选 crawler（爬虫）

- 公网参考信息、政策要点、指南摘要、公开列表字段。
- 复合 `db + 联网查参考` → `db` + `crawler`，**禁止 gui**。
- `needsWebSearch=true` 且需全文抽取（非仅 SERP 摘要）。

### 何时不选 crawler

- 页面内操作（登录、站内搜索、点选）→ **gui**。
- 仅需 SERP 摘要、不需抓正文 → `web_search` + Synth，**不**调爬虫。
- 天气 / 地图 / 日程 / 邮件 / 联系人 / 待办 / 飞书消息 → **admin**（见 admin_capabilities）；搜索/问数勿判 admin。

### 强制联网契约

总管编排的爬虫步骤 **必须**：

1. 先 `web_search` 或 `ensureCrawlerSerpEnhancement`；
2. 将 `seed_urls`、`serp_hits`、`serp_context` 写入 `manager_task_json`；
3. 再调用 Extractor（`crawl_strategy=crawl_seeds`）。

**无 SERP → 禁止调爬虫**（澄清用户或报错）；`MANAGER_CRAWLER_ALLOW_OPEN_DISCOVERY=0` 为默认。

## Planner

- crawler query 写「抽什么」，不写「自己去搜」。
- 同一 `clauseId` **不得**同时绑定 crawler 与 gui。
- 罕见组合：`crawler`（确认登录页 URL）→ `gui dependsOn crawler`。

## 协议字段

见 `manager_task_json`：`seed_urls`、`serp_hits`、`serp_context`、`crawl_strategy`（默认 `crawl_seeds`）。
