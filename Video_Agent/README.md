# Video Agent

> **学习文档**：[入门](../docs/Agent学习指南-入门版.md) · [进阶](../docs/Agent学习指南-进阶版.md) · [Video 专篇](学习指南.md)

基于 **FastAPI + LangGraph + React (Vite)** 的短视频生成 Agent：用户一句话 → 导演/分镜 LLM → **通义万相（Wan）** 文生视频 → 可选调用 Music_Agent 生成 BGM → **ffmpeg** 混流成片。

本目录对应平台编排里的 `video_agent` 服务，默认端口 **13111**。

## 简历摘要（可直接写入项目经历）

- **项目**：10 秒内短视频自动生成服务，嵌入多 Agent 平台，支持 WebSocket 流式节点进度。
- **技术栈**：Python、FastAPI、LangGraph、DashScope Wan API、httpx、ffmpeg、React + Vite。
- **职责亮点**：LangGraph 编排「策划 → 分镜 → 万相异步任务 → QA 重试 → BGM 请求 → 混流」；与 Music_Agent HTTP 联动；产物静态托管与总管媒体代理兼容。

## 核心流程（LangGraph）

1. **Orchestrator / Director / Camera**：LLM 生成镜头脚本与视频 prompt  
2. **Wan 合成**：`wan_video.py` 异步创建任务并轮询 `video_url`  
3. **BGM**：`bgm_client.py` → `Music_Agent` `/api/music/generate-bgm`  
4. **Mux**：下载 OSS 视频与 BGM，ffmpeg 合成 `final_with_bgm_*.mp4`  
5. **QA**：质量节点失败时可重试（`qa_max_fail_retries`）

## 技术栈与目录

- `backend/app/graph.py`：状态图定义  
- `backend/app/wan_video.py`：万相 API  
- `backend/app/llm_video.py`：分镜与 QA LLM  
- `backend/app/bgm_client.py`：音乐服务客户端  
- `frontend/`：任务提交与进度展示  

## 快速开始

**本机开发**（前后端分进程，端口与 LAN 编排不同，避免冲突）：

```bash
cd Video_Agent/backend
pip install -r requirements.txt
# 默认 API 37891，见 .env.example
uvicorn app.main:app --reload --host 0.0.0.0 --port 37891
```

```bash
cd Video_Agent/frontend
npm install
cp .env.example .env   # VITE_* 代理到 37891，前端 56291
npm run dev
```

**LAN / Docker** 单端口 **13111**（前后端一体，见下方 Docker 节）。

WebSocket：`ws://127.0.0.1:<API_PORT>/ws/video`，消息 `type: generate` + `prompt`。

环境变量见 `.env.example`（`DASHSCOPE_API_KEY`、`MUSIC_AGENT_HTTP_URL` 等）。

## 能力边界

- **适合**：短 prompt 文生视频、带 BGM 的演示成片、与总管/多模态编排联调  
- **不适合**：长片剪辑、实时直播、无 ffmpeg 环境下的音画合成  

## Docker / 平台

```powershell
cd Manage-platform_Agent
docker compose -f docker-compose.agents-lan.yml up -d --build video_agent
```

Docker 内 BGM 须指向 `http://music_agent:13110`（compose 已默认注入）。
