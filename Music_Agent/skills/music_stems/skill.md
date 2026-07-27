---
name: music_stems
description: Demucs 音频分轨导出（不重编配）
version: 1.0.0
stage: execution
owner: music_agent
compatible_agents:
  - Music_Agent
  - Manager_Agent
---

## Planning

用户要**分离人声/鼓/贝斯/其他、导出 stems、做卡拉OK伴奏**时：
1. 单步委派 **music**，query 说明分轨需求（不需重编配）。
2. **禁止**承诺「翻唱重混」；分轨后若需新曲应走 compose。

## Execution

- `POST /api/music/stems`，body `{ "saved_filename": "<已上传音频>" }`
- 可选 `model`（默认 htdemucs）、`max_seconds`
- 返回 `stem_urls`: vocals / drums / bass / other

## Reply

列出各轨下载链接；说明 Demucs 在 Docker CPU 上可能较慢。
