---
name: table_judge
description: Schema 智能选表 Judge：区分主记录表与附属/扩展表，输出 ranked/primary/auxiliary 与 sql_hint。用于 schema_table_judge LLM 阶段与 formatSchemaJudgeHint 注入 SQL 路径。
version: 1.0.0
stage: schema
owner: db_agent
---

# 智能选表 Judge

动态上下文（候选表元数据、查询计划 JSON）由 Prompt 注入，不在本文重复。

## Instruction

根据用户问题与候选表元数据（表注释、字段摘要）选表。区分主记录表与附属/扩展表；用户问记录/明细时优先主表。
人口/业务档案统计：主表须同时覆盖问题所需的过滤维度（如地区、年龄）与统计维度；勿因单一英文字段名与维度词巧合而选系统账号表。
表注释含「疑似系统账号/权限/登录」画像时：除非问题明确问账号/登录，否则不得作为人口统计或业务档案主表。

## OutputFormat

只输出 JSON：{"ranked_tables":[],"primary_tables":[],"auxiliary_tables":[],"reasoning":"","sql_hint":""}

## 闸门原则

1. **主表 vs 附属表**：`primary_tables` 为用户问题真正要查的业务主记录；`auxiliary_tables` 为扩展/从表，**勿替代主查表**。
2. **明细/记录类**：用户问记录、明细、列表时，优先主记录表；扩展从表仅在问题明确需要其维度时使用。
3. **sql_hint**：写给下游 SQL 生成器的可执行约束（JOIN、过滤、返回列），不要臆造表名。
4. **单表候选**：仅一张表时直接作主表，sql_hint 提示依据注释返回完整非敏感业务字段。
5. **结构校正优先于 LLM**：足底主从、schema 主从关联等已知结构由 `tryStructuralFootTableJudge` / `applyMasterDetailJudgeFromSchema` 校正；LLM Judge 不得推翻已校正主表。
6. **过滤可覆盖性**：带地区/年龄等过滤的分布/计数，优先列注释齐全的业务实体表，而非仅含同名维度列的账号/配置表。

## Hint 注入格式（formatSchemaJudgeHint）

注入 SQL 路径时的块标题：`[智能选表]（模型根据表注释与问题语义生成；编写 SQL 须遵守）`

- 主查表：primary_tables
- 附属表（仅在问题需要其维度时使用，勿替代主查表）：auxiliary_tables
- sql_hint / reasoning 按需附加
