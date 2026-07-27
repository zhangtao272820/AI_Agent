# Manager_Agent · scripts 索引

> C7 治理后：`scripts/smoke/` 按域分层；根目录仅 CI/运维脚本；治理工具在 `tools/`。

## 目录

| 路径 | 内容 |
|------|------|
| [`smoke/`](./smoke/README.md) | 76 个 smoke 用例（11 子目录） |
| [`tools/`](./tools/) | C5/C6/C7/S1 迁移与审计脚本（17） |
| [`archive/split-migration/`](./archive/split-migration/) | B2 一次性 split 脚本（43） |
| [`archive/c3-migration/`](./archive/c3-migration/) | C3 import 迁移脚本（11） |
| 根目录 `.mjs` | CI 门禁 · metrics · `migrate-c7-tools.mjs` |

## 治理工具（`tools/`）

| 脚本 | 用途 |
|------|------|
| `migrate-c5-rename-core.mjs` | C5 core 域重命名（`--batches plan,shared,...`） |
| `migrate-c5b-rename-layers.mjs` | C5b llm/orchestrate/state 去 `managerGraph.` 前缀 |
| `migrate-c7-smoke-dirs.mjs` | C7-2 smoke 子目录迁移 |
| `fix-c5-domain-imports.mjs` | C5 迁域后相对路径修复 |
| `fix-executors-c5-imports.mjs` | executors/ 域 import 批量修复 |
| `trim-executor-imports.mjs` | **C6** executors import 瘦身 |
| `consolidate-shared.mjs` | **S1** 根 `shared/` 合并 + `agent-repo-shared/` 拷贝 |
| `fix-core-shared-imports.mjs` | 修正 core 模块误指 agent-repo-shared 的 import |
| `check-split-imports.mjs` | graph 静态 import 审计 |
| `trim-exec-node-imports.mjs` | exec 节点 import 瘦身 |

## Smoke 聚合（C7-3）

```bash
npm run smoke:route   # convergence + matrix + orchestration + plan-card
npm run smoke:plan    # clause + orchestrator + scheduler + step-query
npm run ci:gate       # 全量 CI 门禁
```

## Shared（单一 SSOT）

| 路径 | 用途 |
|------|------|
| 仓库根 `shared/` | Agent 矩阵共享模块（PG · memory · chart · protocol）— **唯一 SSOT，进 git** |
| **`Manager_Agent/agent-repo-shared/` 仅此一处** | 本地物理拷贝（`consolidate-shared.mjs`）；**不进 git**；与 Docker `COPY shared ./agent-repo-shared` 路径一致 |
| 其他 Agent（DB/RAG/Code…） | 本地 dev 直接用 `../shared`；**不要**在各自目录建 `agent-repo-shared/` |

代码中统一用 `#agent-shared/*` 别名；**不再有** `Manager_Agent/shared` 与 `shared-pkg`。


`probe/` · `rag/` · `output/` · `db/` · `agent/` · `memory/` · `task/` · `runtime/` · `evolution/` · `routing/` · `plan/` · `shared/` — 各含 `index.ts` barrel。

**C5-11 ✅**：plan flat 已迁入 `core/plan/` 等；`core/` flat **0**。

**C5b ✅**：`llm/` · `orchestrate/` · `state/` 已去 `managerGraph.` 前缀。

**C6 ✅**：executors import 7～16 行。

**本地 shared 同步**（改过根 `shared/` 后）：

```bash
node scripts/tools/consolidate-shared.mjs
```
