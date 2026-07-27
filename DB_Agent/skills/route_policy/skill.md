---
name: route_policy
description: DB_Agent Schema-First 路径策略：Plan 与 Schema 对齐后选择 person_health / person_info / statistics / sql_preflight / sql_agent 执行路径，并生成 route hint 块。
version: 1.0.0
stage: route
owner: db_agent
---

# 路径策略（Route Policy）

运行时决策在 `utils/route/`（`pickExecutionPath` / `buildRouteDecision`）；本文为 SSOT 原则文档。

## 执行路径

| path | 含义 |
|------|------|
| `person_health` | 健康体征档案快路径（person_health_records JOIN） |
| `person_info` | 人员基础档案快路径 |
| `statistics` | 统计/分布/趋势类 |
| `sql_preflight` | 默认结构化链入口：preflight → sql_direct（或 QueryIR） |
| `sql_agent` | 深度 ReAct SQL；skipSqlDirect=true |

## Schema-First（默认 ENABLE_SCHEMA_FIRST）

1. `out_of_scope` → sql_agent（不查库）。
2. **L1 + domain skill 开启**：Judge 确认健康主表 + 有姓名 → `person_health`；Judge 确认人员主表 → `person_info`。
3. 复杂度 L3–L7 → `sql_preflight`（QueryIR/CTE 结构化 SQL）。
4. 否则 → `sql_preflight`（Plan → Schema Judge → sql_direct）。

## 非 Schema-First 回退顺序

1. L3–L7 → sql_preflight。
2. 健康域 + 姓名 + 有体征表 → person_health。
3. 健康域但 schema 无体征表 → sql_preflight。
4. person_basic + detail + person → person_info。
5. aggregation / trend / comparison → statistics。
6. Bandit 学习分 + alignmentPrior 综合打分；person_health 分 ≥0.55 且有机体表 → person_health。
7. 同上下文 trials≥8 且 sql_agent 分显著高于 sql_direct → sql_agent。
8. 默认 sql_preflight→sql_direct。

## Plan ↔ Schema 对齐（analyzeSchemaPlanAlignment）

- `domainMismatch`：plan 数据域与 Judge 主表不一致时修正（如 plan 过窄/主表非健康）。
- `causalTags` 示例：`schema_missing_health_table`、`schema_missing_health_join`、`schema_judge_primary_not_health`、`plan_domain_too_narrow`、`schema_foot_not_health_domain`。
- `refineQueryPlanWithSchema`：域由 schema 链接推断（schema-first 数据域）。

## Judge 闸门（buildRouteDecision）

- 路径为 `person_health` 但 `canUsePersonHealthSkill` 为 false → 降级 sql_preflight。
- 路径为 `person_info` 但 `canUsePersonInfoSkill` 为 false → 降级 sql_preflight。

## Hint 块（formatRouteHintBlock）

标题：`[路径策略]（理解对齐与执行建议，编写 SQL 时须遵守）`

须包含（动态生成）：
- reasons 前 4 条
- domainMismatch 且升级为 person_health 时：**必须 JOIN 健康明细表**
- alignment.causalTags
- entities.names / metrics（若有）

## 学习偏好

- 历史成功/空结果写入 `.data/db-route-preferences.json`；`pathScoreFromPrefs` 与 alignmentPrior 加权（prior 0.62 + learned 0.38）。
