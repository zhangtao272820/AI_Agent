---
name: music_compose
description: AI 作曲 — 自然语言 → MIDI + 试听
version: 2.0.0
stage: execution
owner: music_agent
compatible_agents:
  - Music_Agent
  - Manager_Agent
---

## Planning

当用户要**写歌、作曲、生成纯音乐、指定风格/乐器/时长**时：
1. 委派 **music** 单步，`query` 只写音乐子任务（情绪、风格、配器、时长），勿复制整句用户原话里的非音乐诉求。
2. 若需先识图再作曲：multimodal → music（dependsOn multimodal）。
3. **不支持**音频翻唱重混；若用户要「改编上传的 MP3」，说明改用 compose 或上传 MIDI 换音色。

## Execution

- 首选 WebSocket `type: compose` 或 HTTP `/api/music/compose/async`。
- 返回应含 `midi_url` / `instrumental_wav_url` 供总管展示。

## Reply

用自然语言概括曲风、调性、时长与试听链接；勿暴露内部 JSON 字段名。
