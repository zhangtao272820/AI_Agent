# Companion_Agent / data

运行时配置与资源。**JSON 路径勿随意搬家**（后端硬编码相对 `PROJECT_ROOT/data`）。

## 顶层

| 路径 | 用途 |
|------|------|
| `*.json` | 玩法 / 角色 / 立绘 / 日历等 SSOT |
| `sprites/` | 立绘分档（见 [`sprites/README.md`](./sprites/README.md)） |
| `events/` · `quests/` | 事件与任务 YAML/JSON |
| `bgm/` · `bgs/` | 音乐与场景底图 |
| `tts_cache/` · `tts_pregen/` | TTS 缓存（gitignore / 本地） |
| `companion_save.db` | 本地存档（gitignore） |

## 立绘关键 JSON

| 文件 | 用途 |
|------|------|
| `sprite_catalog.json` | 分档策略与 spinoff 名单 |
| `sprite_gen_manifest.json` | 换装生成清单（由 `build_sprite_gen_manifest.py` 重建） |
| `body_catalog.json` | 身材 SSOT |
| `background_extras.json` | `_background` 地点装饰索引 |
| `expression_map.json` | 情绪 → 表情映射 |
| `social_graph.json` | cast_kind / 关系边 |

## 工作区（gitignore）

`sprites/_staging/`（暂存，可清空）· `sprites/_quarantine/`（归档保留）· `sprites/_pools/`（审阅池）
