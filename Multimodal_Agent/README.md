# Multimodal Agent

> **学习文档**：[入门](../docs/Agent学习指南-入门版.md) · [进阶](../docs/Agent学习指南-进阶版.md) · [Multimodal 专篇](学习指南.md)

基于 **FastAPI + React (Vite)** 的多模态理解服务，为 Agent 矩阵提供「眼睛」与「耳朵」：图像/视频理解、语音转写、图文问答，并可转发 Music / Video 生成请求（总管也可直连后两者）。

本目录对应平台编排里的 `multimodal_agent` 服务，默认端口 **13107**。

## 简历摘要（可直接写入项目经历）

- **项目**：统一多模态入口，承接 Manager_Agent 的识图、听音、看视频与媒体生成编排。
- **技术栈**：Python、FastAPI、Qwen-VL / ASR（DashScope 兼容）、WebSocket 流式、React 前端。
- **职责亮点**：`POST /api/multimodal/unified` 供总管一次调用；图像 OCR/情绪/描述；视频关键帧摘要；实时 WS 转写；音乐/视频生成请求引导至独立 Agent UI。

## 核心能力

| 能力 | API | 说明 |
|------|-----|------|
| 图像理解 | `POST /api/multimodal/analyze` | VL 描述、OCR、情绪 |
| 视频摘要 | 同上 `media_type=video` | 关键帧 + VL 摘要 |
| 语音转写 | `POST /api/multimodal/describe` / WS | ASR |
| 图文问答 | `POST /api/multimodal/qa` | 基于理解结果问答 |
| 总管入口 | `POST /api/multimodal/unified` | Manager_Agent 调用 |
| 音乐/视频生成 | WS `generate_music` / `generate_video` | 返回 redirect 至 Music/Video Agent UI（不内嵌生成） |
| 实时流 | `WS /ws/multimodal` | 口述转写、理解进度 |

## 技术栈与目录

- `backend/app/main.py`、`agent.py`：路由与编排  
- `backend/app/processors/`：`image_processor`、`video_processor`、音频处理  
- `frontend/`：上传与结果展示  

## 快速开始

```bash
cd Multimodal_Agent/backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 13107
```

```bash
cd Multimodal_Agent/frontend
npm install
npm run dev
```

## Docker

```bash
cd Manage-platform_Agent
docker compose -f docker-compose.agents-lan.yml up -d --build multimodal_agent
```

访问：`http://localhost:13107/`

环境变量见 `.env.example`。Docker 内示例：

- `MUSIC_AGENT_UI_URL=http://music_agent:13110`
- `VIDEO_AGENT_UI_URL=http://video_agent:13111`

## 能力边界

- **适合**：识图/OCR、短视频理解、语音转文字、总管多模态路由  
- **不适合**：替代 Music/Video Agent 的深度作曲与长视频生产（应直连对应服务）  
