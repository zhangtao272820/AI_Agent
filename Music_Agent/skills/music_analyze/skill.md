---
name: music_analyze
description: MIDI 乐理分析 — 调性、和弦、结构
version: 2.0.0
stage: execution
owner: music_agent
compatible_agents:
  - Music_Agent
  - Manager_Agent
---

## Planning

用户要**分析 MIDI、看调性和弦、乐谱结构、和声进行**时：
1. 若文件已上传到 Music Agent：HTTP `POST /api/music/analyze`，body `{ "saved_filename": "..." }`。
2. 若用户仅描述要「写一段爵士进行」而无文件：走 **music_compose**，勿伪造分析结果。

## Tools

| 工具 | 路径 |
|------|------|
| 深度分析 | `POST /api/music/analyze` |
| 自动配和声 | `POST /api/music/harmonize` |
| 工具清单 | `GET /api/music/theory/catalog` |
| 导出乐谱 | `POST /api/music/export-score` |

## Reply

用中文概括 `summary_zh`、和弦进行前 8 个；技术细节可折叠，勿贴 raw JSON。
