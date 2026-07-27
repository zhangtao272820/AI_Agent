---
name: music_bgm
description: 短视频 / 视频 BGM 生成
version: 2.0.0
stage: execution
owner: music_agent
compatible_agents:
  - Music_Agent
  - Video_Agent
  - Manager_Agent
---

## Planning

用户或 Video 步骤需要**无歌词背景乐、片头片尾、15–30 秒 BGM** 时：
1. music 单步或 Video 内部调用 `POST /api/music/generate-bgm`。
2. `query` / `prompt` 写 mood、energy、instrumentation、duration_seconds。

## Execution

- API：`POST /api/music/generate-bgm`，body 含 `prompt`、`duration_seconds`、`music_brief`（可选）。
- 默认 `COMPOSE_BACKEND=rule`（算法 MIDI）；神经 BGM 需显式开启 MusicGen/Stable Audio。

## Reply

说明时长、情绪与 `audio_url`；标注是否含歌词（BGM 应为无歌词）。
