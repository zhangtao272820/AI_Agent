# workflow-macros Skill（OpenClaw Lobster 工作流壳 · 对齐）

> 确定性 YAML/JSON 宏：`goto` → `type/click` → `approve` → `finish`，少步可复现。

## 何时加载

- 总管 / 调用方传入 `workflow_id`（或用户 hint `工作流:xxx`）
- 重复 OA / 固定表单黄金路径（如 `httpbin-form-fill`）

## 规则

1. 有 `workflow_id` 时 **优先** Workflow 引擎，不经逐步 LLM StepDecide
2. `approve` 步走与 classic 相同的 HITL confirm；测试可设 `LOBSTER_WORKFLOW_AUTO_APPROVE=1`
3. 宏失败 **不**静默冒充成功；调用方可另起自然语言 gui 任务回退
4. 宏文件目录：`Lobster_Agent/workflows/*.json`（可用 `LOBSTER_WORKFLOWS_DIR` 覆盖）

## 完成标准

- `finish.answer` 插值后非空；`actualEngine=workflow`；`agentResult` 同构

## 禁止

- 无确认执行支付 / 删除
- 把 recipe/`preferred_engine` 写成 forced `engineHint` 锁死回退链
