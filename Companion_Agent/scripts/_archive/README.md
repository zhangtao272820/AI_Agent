# scripts/_archive — 一次性迁移（勿日常运行）

这些脚本已完成历史搬家/人设对齐；产物已在 `data/` 与 `data/sprites/`。复现实验时再调用；日常用上级 [`../README.md`](../README.md) 所列现行工具。

## 立绘迁移

| 脚本 | 当时用途 |
|------|----------|
| `organize_sprite_pools.py` | 正式目录清洗 → pools |
| `reassign_outfit_gens_to_neutral_npc.py` | 不合格换装撤出再分配 |
| `spinoff_cast_from_pools.py` | 池图 → 新中立/NPC |
| `register_spinoff_cast.py` | 注册 spinoff 到各 catalog |
| `separate_sprite_cast_dirs.py` | 扁平目录 → romance/neutral/npc |
| `stage-emotion-tachie.py` | tachie 包 → sprites |
| `stage-sprite-previews.py` | 解压包精选差分 |

## 人设 / 身体一次性

| 脚本 | 当时用途 |
|------|----------|
| `redesign_cast_roles.py` | 开局关系 / cast_kind |
| `enrich_social_edges_p3.py` | social_graph 边 |
| `enrich_social_schedules.py` | 职业与日程 |
| `enrich_body_silhouette.py` | body_catalog 体型字段 |
| `inject_bust_visual.py` | bust_visual |
| `align_data_identity.py` | 身份目录对齐 |
| `sync_body_to_roles.py` | body → model_roles |
| `update_sprite_expansion_manifest.py` | 扩展 taxonomy 写入 manifest |
| `generate-model-roles.py` | 生成 model_roles 骨架 |
