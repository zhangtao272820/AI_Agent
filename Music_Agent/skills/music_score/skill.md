---
name: music_score
description: MIDI 导出 MusicXML / PDF / ABC
version: 1.0.0
stage: execution
owner: music_agent
compatible_agents:
  - Music_Agent
  - Manager_Agent
---

## Planning

用户要**乐谱、五线谱、MusicXML、ABC** 时：
1. 需已有 MIDI（compose 产物或上传）。
2. `POST /api/music/export-score`，body `{ "saved_filename": "xxx.mid" }`。

## Execution

- 返回 `urls.musicxml` / `urls.pdf`（需 LilyPond）/ `urls.abc`
- compose 流程也会在 WS `exports` 阶段附带 musicxml

## Reply

提供可下载链接；PDF 失败时说明需 LilyPond，MusicXML/ABC 通常可用。
