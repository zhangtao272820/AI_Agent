# Music Agent

> **学习文档**：[入门](../docs/Agent学习指南-入门版.md) · [进阶](../docs/Agent学习指南-进阶版.md) · [Music 专篇](学习指南.md)  
> **瘦身与路线图**：[doc/瘦身与能力路线图.md](doc/瘦身与能力路线图.md) · [MCP 分阶段接入](doc/MCP音乐能力-分阶段接入.md)

基于 **FastAPI + React (Vite)** 的 AI 作曲与 MIDI 服务：自然语言描述 → 结构化作曲意图 → MIDI 编排与校验 → SoundFont 试听/导出；支持 **上传 MIDI 换 GM 音色**、BGM 生成、歌词与听感字幕等。

本目录对应平台编排里的 `music_agent` 服务，默认端口 **13110**。

## 核心功能（Phase 1）

| 能力 | 说明 |
|------|------|
| AI 作曲 | 文本/结构化意图 → `compose_midi` → music21 校验 → FluidSynth 渲染 WAV |
| BGM 生成 | 按时长、调性、情绪生成背景乐（供 Video_Agent 混流） |
| MIDI 换音色 | 上传 `.mid` → 保留音符，仅更换 GM 乐器 → 渲染试听 |
| 上传分析 | 音频试听、Whisper 歌词转写、诗意写词、听感可视化 |
| 乐理分析 | `POST /api/music/analyze` — 调性、和弦进行、声部结构 |
| 自动配和声 | `POST /api/music/harmonize` — 主旋律 + 块和弦 + 贝斯 → 新 MIDI/WAV |
| 乐谱导出 | `POST /api/music/export-score` — MusicXML / PDF / ABC |
| Demucs 分轨 | `POST /api/music/stems` — vocals/drums/bass/other（**CPU**，Docker 默认） |
| 神经 BGM | ⏸ 延后：需 GPU + `INSTALL_NEURAL_DEPS=1` |
| 实时交互 | WebSocket 推送阶段事件；前端节奏背景与歌词舞台 |

## 已下线（Phase 1 瘦身）

- **音频翻唱 / 算法重演绎**（Spleeter + Basic Pitch + 重编配）：质量不可接受，默认关闭。  
  恢复开发调试：`ENABLE_AUDIO_REMIX=true` + Docker `INSTALL_REMIX_DEPS=1`。

## 技术栈

- **后端**：`main.py`、`midi_engine.py`、`llm.py`、`music21_validate.py`
- **前端**：`frontend/src/App.tsx`
- **部署**：`Dockerfile`；LAN 编排见 `Manage-platform_Agent/docker-compose.agents-lan.yml`

## 快速开始

```bash
cd Music_Agent/backend
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 13110
```

```bash
cd Music_Agent/frontend
npm install
npm run dev
```

环境变量见 `.env.example`。

## Docker

```powershell
cd Manage-platform_Agent
docker compose -f docker-compose.agents-lan.yml up -d --build music_agent
```

默认镜像**不安装** Spleeter / Basic Pitch。需要遗留音频 remix 时：

```powershell
docker build --build-arg INSTALL_REMIX_DEPS=1 -t music_agent:remix ../Music_Agent
```

## 能力边界

- **适合**：旋律/伴奏生成、BGM、MIDI 换音色、与总管/视频 Agent 联动
- **不适合**：音频翻唱重混、实时低延迟演奏、无版权素材的商用发行（需自行合规）
