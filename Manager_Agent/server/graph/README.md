# server/graph — Manager LangGraph modules (B2)

Auto-reorganized from `server/utils/managerGraph*.ts`. Shim cleanup (C4/B6) complete.

| Directory | Role | Files |
|-----------|------|-------|
| `state/` | Graph factory, invoke config, typed state | 4 |
| `nodes/` | LangGraph node implementations | 25 |
| `llm/` | LLM prompt/schema helpers | 18 |
| `orchestrate/` | Unified/chat/pro orchestration | 13 |
| `core/` | Shared graph utilities | **0 flat** · **19+** 域子目录 |

**C5/C5b ✅**：128 模块迁入域目录；`llm/` · `orchestrate/` · `state/` 已去 `managerGraph.` 前缀（`graphEntry.ts` · `runtimeBundle.ts` 等）。

**C6 ✅**：`core/executors/` import 瘦身（`trim-executor-imports.mjs`）。

**C7 ✅**：smoke 在 [`scripts/smoke/`](../scripts/smoke/README.md)；41 npm 别名 + `smoke:route`/`smoke:plan` 聚合。

**S1 ✅**：共享模块 SSOT 为仓库根 [`shared/`](../../../shared/)；Manager 本地镜像 [`agent-repo-shared/`](../../agent-repo-shared/)（不进 git）。

See [`doc/split-cleanup-playbook.md`](../../doc/split-cleanup-playbook.md).
