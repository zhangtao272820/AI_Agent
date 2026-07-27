# DB Agent

> **学习文档**：[入门](../docs/Agent学习指南-入门版.md) · [进阶](../docs/Agent学习指南-进阶版.md) · [DB 专篇](学习指南.md)

基于 **Nuxt 4 + LangGraph** 的单库自然语言查数 Agent。

## 治理与优化（2026-07-10）

- [优化路线图](doc/optimization-roadmap.md) — **D-P0～D-P2 已全部 ✅**
- [拆分与优化 Playbook](doc/split-cleanup-playbook.md) — 主链拆分批次、smoke 门禁
- [环境变量参考](doc/env-reference.md) — profile / 档位 / NLU preset 优先级
- [Skills 双体系边界](doc/db-agent-skills-boundary.md)
- [LLM-First 约束](doc/db-agent-llm-first-constraints.md)
- [人员域升级方案](doc/person-basic-stats-llm-first-upgrade.md)

**近期完成**：env-reference · Manager `ci:gate` smoke:db-all · split-exports 回归 · 总管 `/api/ask` 500 修复。

## 快速开始

```bash
cd DB_Agent
npm install
cp .env.example .env   # 或编辑现有 .env
npm run dev
```

## .env（仅保留必改项）

```bash
OPENAI_API_KEY=sk-...
MYSQL_PASSWORD=...
MYSQL_DATABASE=p2026

# 能力层（SSOT：Manage-platform_Agent/backend/app/capability_models.py）
OPENAI_ORCHESTRATION_MODEL=qwen3-14b               # T0 route
OPENAI_NLU_MODEL=qwen3-14b                         # T0 route
OPENAI_AGENT_MODEL=qwen3-coder-flash               # T2 coder
EMBEDDING_MODEL=text-embedding-v1                  # E0 embedding
```

其余开关、token 预算 → `utils/db_agent_env.ts` 的 `DB_AGENT_DEFAULTS`  
库级补丁 → `data/domains/<DB_AGENT_DOMAIN>/`（`DB_AGENT_DOMAIN=p2026` 为养老范例；`generic` 为纯通用）  
运行档位 → `DB_AGENT_PROFILE=low_token|balanced|full`；**生产推荐 `balanced`**（详见 `utils/db_agent_env.ts`）
本地灌数 → `npm run seed:p2026-person`（可选，重置 person 相关测试数据）  
Metrics 目录 → `GET /api/metrics-catalog`（P3 补丁 metrics.json）
Schema 缓存刷新 → `POST /api/schema/refresh`

## Smoke（本地门禁）

```bash
npm run smoke:all          # 无 MySQL：9 条（含 nlu-mode / sql-path / domain-modules / split-exports）
npm run smoke:structural-link   # 需 MySQL
npm run smoke:decompose         # 需 DB_Agent HTTP（默认 :13101）
```

Manager `ci:gate` 已接入：`npm run smoke:db-all`（聚合上述 9 条）。

## 查询路径

```text
repeat → condense → plan → schema_ground → route
  → statistics（generic_stats / 领域模板 + LLM 路由）
  → sql_plan_direct（preflight+SQL 单次 LLM，默认 low_token）→ sql_direct → sql_agent（fallback）
```

主链 `conversational_retrieval_chain.ts` 仅 ~142 行；LangGraph 在 `utils/graph/`；前端页 `index.vue` ~36 行，聊天 UI 在 `components/db-chat/`。

观测：`GET /api/metrics`、`GET /api/learning`（含路径 Bandit 偏好）  
反馈：`POST /api/feedback` `{ question, score: 1|-1 }`

进化数据目录：`.data/`（学习信号、经验回放、影子 prompt 补丁、**路径偏好**）

Skill 化待办见 [docs/Skill化升级计划.md](../docs/Skill化升级计划.md)（DB 章节）。

## 与总管

`POST /api/ask`、`/api/plan`、`/api/probe` 与 `managerTask` 载荷**协议不变**；`dbId` 忽略，始终连 `MYSQL_DATABASE`。换库写 `data/domains/<db>/` 补丁，总管侧无需改代码。

## 新库接入（生产 checklist）

1. **连库**：`.env` 设 `MYSQL_*`；`DB_AGENT_DOMAIN=generic` 试跑  
2. **注释 SSOT**：为每张业务表/列写清中文 `COMMENT`（设备名、指标含义）  
3. **冒烟**：页面或总管协议手工提 10–20 条本库典型问句，确认 `sql_direct` 与选表正确  
4. **补丁**：复制 `data/domains/p2026/` → `data/domains/<新库>/`，只改 JSON（blueprint / relations / metrics）  
5. **部署**：Docker 需含 `data/domains/`（见 `Manage-platform_Agent/docker/nuxt-agent/Dockerfile`）；一库一 `db_agent` 实例  
6. **观测**：`GET /api/config` 确认 `patch.id`；`GET /api/metrics` 看 path 与 `llm_calls`
