---
name: music_lyrics
description: 歌词转写与诗意写词
version: 2.0.0
stage: execution
owner: music_agent
compatible_agents:
  - Music_Agent
  - Manager_Agent
---

## Planning

用户上传**含人声音频**并要：
- 转写歌词 → 上传时自动 Whisper；或引导至 Music Agent 上传页。
- **原创诗意中文词**（非原曲复制）→ `POST /api/music/poetic-lyrics`，需 `song_title` + `saved_filename`。

## Constraints

- 诗意歌词为**原创**，基于曲名/歌手/分析摘要，不声称复刻原曲版权文本。
- 听感四边文案走 `playback_insight` / `listening-captions`，与歌词转写独立。

## Reply

呈现歌词或诗意正文；注明「转写」vs「原创生成」。
