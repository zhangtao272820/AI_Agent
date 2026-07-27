# C3 一次性迁移脚本（已归档）

> **勿再执行**。C3 import canonical 迁移已于 2026-07 完成；保留仅供审计与回滚参考。

| 文件 | 用途 |
|------|------|
| `migrate-c3-batch2.mjs` | smoke/scripts import 迁 graph |
| `migrate-c3-batch3.mjs` | api/plugins/utils import 迁 graph |
| `migrate-c3-batch4.mjs` | graph core 内部 shim → canonical |
| `migrate-node-shims-batch1.mjs` | nodes 层 shim batch-1 |
| `repair-c3-batch2-collisions.mjs` | batch-2 路径碰撞修复 |
| `repair-c3-batch2-nodes.mjs` | batch-2 nodes 路径修复 |
| `repair-batch7-8.mjs` | mega split 后 repair |
| `repair-batch-node-splits.mjs` | 节点拆分 repair |
| `reorg-manager-graph.mjs` | B2 graph 目录初重组 |
| `reorg-utils-domains.mjs` | B6 utils 域初重组 |

活跃治理工具见 `scripts/` 根目录：`check-split-imports.mjs`、`migrate-c5-rename-core.mjs` 等。
