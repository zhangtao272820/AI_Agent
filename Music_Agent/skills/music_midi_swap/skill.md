---
name: music_midi_swap
description: 上传 MIDI 换 GM 音色（保留音符）
version: 1.0.0
stage: execution
owner: music_agent
compatible_agents:
  - Music_Agent
  - Manager_Agent
---

## Planning

用户已上传 **.mid / .midi**，要**换乐器、换音色、GM 试听**，且**不改音符**时：
1. 引导至 Music Agent 上传页，或 HTTP 说明需 `saved_filename`。
2. WebSocket `type: midi_swap`（或 `remix` + MIDI 文件）。
3. **不支持**对 MP3 做换音色重混。

## Execution

- WS payload：`{ "type": "midi_swap", "saved_filename": "<uuid>_file.mid", "remix_style": "auto" }`
- 产物：`midi_url`、`instrumental_wav_url`

## Reply

说明已保留原曲音符，仅更换 GM 乐器；给出试听 / 下载链接。
