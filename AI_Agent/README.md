# AI_Agent — 实时 AI 虚拟化身（个人免费额度）

> **学习文档**：[入门](../docs/Agent学习指南-入门版.md) · [进阶](../docs/Agent学习指南-进阶版.md) · [AI 专篇](学习指南.md)

与仓库根目录 `框架.md` 对齐：**麦克风 → Qwen3-ASR → 千问对话 → Qwen3-TTS → 前端展示**（默认 `client_rhythm` 假口型，**无需 GPU**）。

## 怎么启动（默认，无 GPU 对口型）

1. **配置** — 复制 `AI_Agent/.env.example` → `AI_Agent/.env`，填入百炼 Key。默认已设：

   ```env
   LIP_SYNC_MODE=client_rhythm
   ```

   待机循环 `video/ai.mp4`，说话时 TTS 音量驱动轻微动效（非真对口型）。

2. **终端 — 后端** / **前端**（见下「两步启动」）。

### 可选：本地真对口型（需 GPU + Ultralight 数据集）

1. `.env` 改为 `LIP_SYNC_MODE=local_ultralight`，并配置 `LIPSYNC_*`
2. 启动对口型微服务：[`services/lipsync/README.md`](services/lipsync/README.md) 或 Docker `--profile lipsync`
3. 详见 [`doc/ultralight-docker-setup.md`](doc/ultralight-docker-setup.md)

## 怎么启动（两步）

1. **配置环境变量**  
   复制 **`AI_Agent/.env.example` → `AI_Agent/.env`**，填入 [百炼 API Key](https://dashscope.console.aliyun.com/apiKey) 等。**所有业务配置以 `.env` 为准**；Docker 通过 compose `env_file` 挂载 `/app/.env`，不在 Dockerfile 里写模型/Key。  
   本地开发、Docker 共用同一文件；Docker 部署请取消 `.env.example` 里「Docker 部署」段的路径注释。

2. **开两个终端分别启动**

   **终端 A — 后端**（`http://127.0.0.1:8080`，WebSocket：`ws://127.0.0.1:8080/ws`）：

   ```powershell
   cd e:\Agent\AI_Agent\backend
   pip install -r requirements.txt
   uvicorn app.main:app --host 0.0.0.0 --port 8080 --reload
   ```

   **终端 B — 前端**（浏览器打开终端里提示的地址，一般为 `http://127.0.0.1:5174`）：

   ```powershell
   cd e:\Agent\AI_Agent\frontend
   npm install
   npm run dev
   ```

   健康检查：浏览器访问 `http://127.0.0.1:8080/health`，`has_key` 应为 `true`（表示已读到 Key）。

## 目录

- `backend/`：FastAPI、`/ws` 实时会话、LangGraph 流水线、`local_lipsync.py` 本地对口型客户端。
- `services/lipsync/`：Ultralight 流式 + Wav2Lip 微服务（端口 8091）。
- `frontend/`：Vite + React；`lip_sync_frame` 逐帧预览，完成后播放缓存 MP4。
- `.env`：本地配置（已加入 `.gitignore`，勿提交密钥）。
- `.env.example`：变量说明备份。

## 环境变量说明

| 变量 | 说明 |
|------|------|
| `DASHSCOPE_API_KEY` | 百炼 Key（推荐） |
| `OPENAI_API_KEY` | 可与上一项二选一，代码会合并读取 |
| `OPENAI_BASE_URL` | 默认中国大陆兼容端点；国际站见 `.env` 内注释 |
| `ASR_MODEL` / `LLM_MODEL` / `TTS_MODEL` / `TTS_VOICE` | 可选，默认已写在 `.env` |

若前后端不同机，在前端目录建 `.env.local` 设置 `VITE_WS_URL=ws://服务器IP:8080/ws`。

## WebSocket 协议（简要）

客户端发送：

```json
{ "type": "utterance", "payload": { "mode": "text", "text": "你好" } }
```

或

```json
{ "type": "utterance", "payload": { "mode": "audio", "mime": "audio/webm;codecs=opus", "audio_base64": "..." } }
```

服务端按顺序推送：`pipeline_started` → `transcript` → `reply` → `lip_sync` → `tts_audio`（base64）→ `done`；错误为 `error`。

## 数字人「有没有画面」、怎么接视频模型动起来

### 现在项目里是什么画面？

- **有画面，但不是「视频模型生成的数字人」**：前端是你上传的**一张静态照片**全屏展示；说话时靠 **TTS 音量** 做一点缩放/光晕（**假口型**），没有调用万相/文生视频等模型。
- **没有**：实时摄像头驱动、没有 MP4 流、没有 Wan 返回的「真对口型」视频层。

### 想「真动起来」要接哪类 API？

与 `框架.md` 一致时，个人开发者最常用的是百炼 **音频驱动静态图 → 说话视频**：

| 能力 | 百炼侧典型模型 | 输入要点 |
|------|----------------|----------|
| **说话 / 对口型 / 轻微动作**（与当前流水线最顺） | **`wan2.2-s2v`** | **公网可访问**的 `image_url` + `audio_url`（wav/mp3，官方限制见文档） |
| **用参考视频迁移动作**（跳舞、复刻动作） | **`wan2.2-animate-move`** 等 | 人物图 + **参考视频 URL**，与「只 TTS 一段语音」的链路不同 |

官方文档（对口型、异步任务、轮询拿 `video_url`）：  
[万相 wan2.2-s2v 数字人对口型视频生成 API](https://help.aliyun.com/zh/model-studio/wan-s2v-api)

### 接入思路（后端 + 前端）

1. **TTS 之后**你已经有了回复语音（本项目里是内存里的音频字节）。要先变成 **`audio_url`**：上传到 **OSS** 或走百炼 [上传文件获取临时 URL](https://help.aliyun.com/zh/model-studio/get-temporary-file-url)（模型要求 HTTP/HTTPS，**不能**直接塞本地路径）。
2. **用户头像**若目前是本地 DataURL，同样需要 **公网 `image_url`**（同上）。
3. 调用异步接口创建任务（文档示例为 `POST .../image2video/video-synthesis`，Header 带 `X-DashScope-Async: enable`，Body 里 `model`=`wan2.2-s2v`，传入 `input.image_url` / `input.audio_url` 等）。
4. **轮询** `GET https://dashscope.aliyuncs.com/api/v1/tasks/{task_id}` 直到 `SUCCEEDED`，读取 `output.results.video_url`。
5. 通过 **WebSocket** 把 `video_url` 推给前端，用 **`<video src={url} controls playsInline />`** 播放（链接通常 **24 小时内有效**，需要可自建转存）。

**注意**：`wan2.2-s2v` 文档写明任务往往要 **数分钟量级**，属于**异步生成**，和「低延迟实时通话」不是同一类体验；若要坚持低延迟，只能继续用现在的「静态图 + 音频驱动假口型」，或另接 RTC/第三方实时数字人。

### 和本仓库其它代码的关系

`Video_Agent/backend/app/wan_video.py` 里对 **`VideoSynthesis.async_call` + `fetch` 轮询** 的写法，可迁移到 `AI_Agent` 的 LangGraph **`lip_sync` 节点**里；但 **image2video / s2v** 的 HTTP 路径与入参以 [wan-s2v 文档](https://help.aliyun.com/zh/model-studio/wan-s2v-api) 为准（可能与文生视频任务字段略有差异）。地域上 **s2v 文档目前针对中国内地（北京）**，请与你的 Key、Endpoint 区域一致。

本示例在 `backend/app/graph.py` 仍保留 **`lip_sync` 占位节点**，便于你改为「上传 URL → 创建 s2v 任务 → 轮询 → 把 `video_url` 塞进 state → `main.py` 里多推一种 WebSocket 消息」。
