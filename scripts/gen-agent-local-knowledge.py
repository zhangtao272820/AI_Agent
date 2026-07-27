#!/usr/bin/env python3
"""Generate Agent知识-本地.md for each Agent (gitignored, local learning only)."""
from __future__ import annotations

import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEST = "\u5b66\u4e60\u6307\u5357-\u672c\u5730.md"  # 学习指南-本地.md -> use Agent知识-本地.md
DEST = "\u0041\u0067\u0065\u006e\u0074\u77e5\u8bc6-\u672c\u5730.md"  # Agent知识-本地.md

HEADER = """# {title} · 核心实现与 Agent 知识（本地私有）

> ⚠️ **仅供本地学习**：本文件已在仓库根 `.gitignore` 中（`**/Agent知识-本地.md`），**不要提交到 Gitee**。  
> 公开概念导读见 [学习指南.md](学习指南.md) · 部署见 [README.md](README.md)。

---

"""

AGENTS: dict[str, str] = {}

def doc(title: str, body: str) -> str:
    return HEADER.format(title=title) + body

AGENTS["Manager_Agent"] = doc("Manager_Agent", """## 一、核心代码架构

```text
app/pages/index.vue          # 聊天 UI
server/api/manager-ws.ts     # WebSocket 入口（chat/confirm/cancel）
server/utils/managerGraph.*  # LangGraph 编排 SSOT
server/utils/agents/*        # 下游 HTTP/WS 客户端（ragClient、dbClient…）
shared/                      # 与前端/下游共享的类型与规则
```

**角色**：编排层（Orchestrator）— 不执行业务 SQL/RAG/代码，只路由与汇总。

---

## 二、模块精读

| 模块 | 文件 | 职责 | 建议关注 |
|------|------|------|----------|
| WS 协议 | `server/api/manager-ws.ts` | 会话、流式 `phase` 事件 | 消息类型 `chat` / `confirm` / `cancel` |
| 图定义 | `server/utils/managerGraph.graph.ts` | 节点与条件边 | `addConditionalEdges` 分支 |
| 探针 | `server/utils/managerGraph.probeNode.ts` | 规划前下游快照 | `hasDocs`、schema 探活 |
| 路由 | `server/utils/managerGraph.routeNode.ts` | 选 capability | 输出 `rag`/`db`/`code` 等 |
| 规划 | `server/utils/managerGraph.planNode.ts` | 多步 `steps[]` | 与 `skills/planner_playbook/` |
| 执行 | `server/utils/managerGraph.agentExecutors.ts` | `callRagAgent` 等 | 超时、unwrap、`agent_error` |
| 注册表 | `server/utils/managerGraph.agentRegistry.ts` | 12+ capability ID | 端点与健康 |
| HITL | `server/utils/managerGraph.checkpointStore.ts` | 确认态落盘 | `.data/checkpoints/` |
| 合成 | `managerGraph.finalNodes.ts` | synth + finalize | evidence 拼接 |
| 平台同步 | `server/utils/agentPlatformSync.ts` | ClawHive 拉配置 | ~60s 轮询 |

---

## 三、一条用户消息的链路

1. 前端 WS 发 `{ type: "chat", text: "..." }` → `manager-ws.ts`
2. 初始化 run state → 进入 `managerGraph.graph.ts`
3. `probe`：调 RAG `/api/probe`、DB `/api/probe` 等
4. `route`：LLM 或规则选主 capability
5. `plan`：拆成 `steps`（如 `db` → `visualize`）
6. `execute`：`agentExecutors.ts` 调下游，收集 `AgentResult`
7. `synth` / `critic` / `finalize` → WS 推 `answer` + `agent_evidence`

---

## 四、学到的 Agent 知识

| 概念 | 本仓库实现 |
|------|------------|
| **Supervisor 模式** | Manager 专家分离，单一 WS 入口 |
| **LangGraph 状态机** | 40+ 节点，条件边驱动 clarify/fix |
| **Probe before Plan** | 避免无文档/无库仍硬答 |
| **HITL** | checkpoint 落盘 + 前端 confirm |
| **Multi-Agent 协议** | `managerTask` JSON 载荷 SSOT |
| **内部协作者** | visualize/report 非独立服务 |
| **Graceful Degrade** | 扩展 Agent offline 时降级 |

---

## 五、3 天精读计划

| 天 | 任务 |
|----|------|
| D1 | `manager-ws.ts` + `managerGraph.graph.ts` 手绘节点图 |
| D2 | `probeNode` + `routeNode` + `planNode` |
| D3 | `agentExecutors.ts` 任选一个下游跟完 HTTP 调用 |

---

## 六、笔记区

（在此记录你的调试发现、断点位置、面试话术草稿）
""")

AGENTS["RAG_Agent"] = doc("RAG_Agent", """## 一、核心代码架构

```text
server/api/upload.post.ts    # 文档入库
server/api/retrieve.post.ts  # 程序化检索（总管 retrieve-first）
server/api/chat.post.ts      # 对话 / managerTask
server/utils/agent.ts        # LangGraph 主图
server/utils/document_retrieval.ts  # 混合检索
server/utils/vectorStore.ts  # 向量存取
```

---

## 二、模块精读

| 模块 | 文件 | 职责 |
|------|------|------|
| 入库 | `upload.post.ts` + `chunk_text.ts` | 解析、分块、embed |
| 意图 | `doc_scope_judge.ts` | 列表 vs QA vs 澄清 |
| 混合检索 | `document_retrieval.ts` | 向量 + BM25 + lane 融合 |
| 词法 | `bm25_lexical.ts` | BM25 召回 |
| 重排 | `cross_encoder_rerank.ts` / `onnx_rerank.ts` | Top-K 精排 |
| Agentic | `agentic_retrieval.ts` | 子查询、多轮 |
| 向量库 | `vectorStore.ts` | memory / pgvector |
| 结果 | `agent_result.ts` | evidence、citations |
| 总管对接 | `manager_orchestration.ts` | managerTask 语义 |

---

## 三、查询链路

1. `doc_scope_judge` 分流
2. `query_condense` 多轮指代消解
3. `document_retrieval` 混合召回 → rerank
4. `agent.ts` LangGraph：检索 → LLM 生成（带 snippet）
5. 无证据 → `<RAG_NEEDS_CLARIFY>` 或拒答

---

## 四、学到的 Agent 知识

| 概念 | 实现要点 |
|------|----------|
| **RAG 两阶段** | Index（upload）与 Query（retrieve/chat） |
| **Hybrid Search** | 向量语义 + BM25 关键词 |
| **Rerank** | 召回后 cross-encoder 降噪 |
| **Citation / Grounding** | evidence 挂回答，降幻觉 |
| **Agentic RAG** | 子查询分解、多跳检索 |
| **Retrieve-first** | 编排层先 `/api/retrieve` 再 synth |

---

## 五、3 天精读计划

| 天 | 任务 |
|----|------|
| D1 | `vectorStore.ts` + 上传一条 PDF 跟日志 |
| D2 | `document_retrieval.ts` + `doc_scope_judge.ts` |
| D3 | `agent.ts` 图 + Manager `ragClient.ts` |

---

## 六、笔记区

""")

AGENTS["DB_Agent"] = doc("DB_Agent", """## 一、核心代码架构

```text
server/api/chat.post.ts           # managerTask / 对话入口
utils/conversational_retrieval_chain.ts  # 主链路
utils/nlu/                        # 意图、plan、condense
utils/sql_safety.ts               # 只读护栏
data/domains/<db>/                # 领域 JSON 补丁
```

---

## 二、模块精读

| 模块 | 文件 | 职责 |
|------|------|------|
| 主链 | `conversational_retrieval_chain.ts` | sanitize→plan→route→SQL |
| 接地 | `schema_ground.ts` | 表/列筛选注入 prompt |
| 安全 | `sql_safety.ts` | 拒绝 DML、LIMIT |
| 直出 | `sql_plan_direct.ts` / `sql_direct.ts` | 单次 LLM SQL |
| 统计 | `generic_statistics.ts` | 模板化统计 |
| 路由 | `utils/nlu/router.ts` | 选 statistics / direct / agent |
| 领域 | `data/domains/p2026/` | blueprint、relations、metrics |
| 学习 | `query_learning.ts` | Bandit、反馈 |

---

## 三、问数链路

1. `incoming_question` 清洗
2. `dbCondenseLlm` 压短意图
3. `schema_ground` 选表列
4. `router` 选路径（模板 / direct / agent）
5. `sql_safety` 校验后执行 MySQL
6. 返回表格 JSON（**不出图**— 图表在 Manager visualize）

---

## 四、学到的 Agent 知识

| 概念 | 实现 |
|------|------|
| **NL2SQL / Text-to-SQL** | 多路径降级 |
| **Schema Grounding** | COMMENT + 关系图裁剪 |
| **Tool Safety** | 只读 SQL 护栏 |
| **Cascade Router** | 简单走模板，复杂走 Agent |
| **Domain Patch** | 换库只改 JSON |
| **职责分离** | DB 查数 vs Manager 画图 |

---

## 五、3 天精读计划

| 天 | 任务 |
|----|------|
| D1 | `sql_safety.ts` + 故意注入 DELETE 看拦截 |
| D2 | `schema_ground.ts` + `router.ts` |
| D3 | `data/domains/p2026/` 对照一条问句 |

---

## 六、笔记区

""")

AGENTS["code_assistent_Agent"] = doc("code_assistent_Agent", """## 一、核心代码架构

```text
server/services/agent.ts       # LangGraph + 工具循环
server/routes/_ws.ts           # WebSocket 流式
server/services/codeAnalyzer.ts
server/utils/code_execution.ts # vm 沙箱
server/middleware/01-auth.ts   # JWT
```

---

## 二、模块精读

| 模块 | 文件 | 职责 |
|------|------|------|
| Agent 主逻辑 | `agent.ts` | ReAct：read/search/analyze/patch |
| 语义检索 | `code_cross_agent_memory.ts` | 仓库 embedding 检索 |
| 静态分析 | `codeAnalyzer.ts` | AST、依赖 |
| Bug | `bugDetector.ts` | 规则 + LLM |
| 沙箱 | `code_execution.ts` | Node vm 5s |
| 鉴权 | `01-auth.ts`、`00-rate-limit.ts` | JWT + 限流 |
| 总管 | `managerCodeTaskPayload.ts` | managerTask 载荷 |

---

## 三、工具调用链路

1. WS 收用户指令 → `agent.ts` 入图
2. LLM 选 tool（list/read/search/analyze…）
3. 工具读盘或检索 → 结果回填 messages
4. 写操作前出 **Diff 预览** → 用户确认后 apply
5. `agent_result.ts` 统一返回结构

---

## 四、学到的 Agent 知识

| 概念 | 实现 |
|------|------|
| **ReAct / Tool Use** | LangGraph 多轮 tool 节点 |
| **Coding Agent 安全** | 沙箱、路径、JWT、Diff 预览 |
| **Code RAG** | 语义搜文件再精读 |
| **read-before-write** | 禁止盲写盘 |

---

## 五、3 天精读计划

| 天 | 任务 |
|----|------|
| D1 | `agent.ts` 工具列表与图边 |
| D2 | `codeAnalyzer.ts` + 一次 analyze 会话 |
| D3 | `code_execution.ts` 边界测试 |

---

## 六、笔记区

""")

AGENTS["Extractor_Agent"] = doc("Extractor_Agent", """## 一、核心代码架构

```text
server/services/crawlerAgent.ts          # 对外入口
server/services/crawlerAgentWorkflow.ts  # LangGraph
server/services/crawlerAgentTaskPlanning.ts
server/core/index.ts                     # Fetch + Extract 引擎
server/core/verify/qualityGate.ts
patches/sites/*.json                     # 站点规则
```

---

## 二、模块精读

| 模块 | 文件 | 职责 |
|------|------|------|
| 规划 | `crawlerAgentTaskPlanning.ts` | NL → plan |
| 工作流 | `crawlerAgentWorkflow.ts` | Plan→Fetch→Extract |
| 抓取 | `crawlerAgentExtractors.ts` | HTTP / Playwright |
| 抽取 | patch→template→rule→llm 降级 | |
| 门禁 | `qualityGate.ts` | 条数、schema |
| 站点 | `patches/sites/` | 确定性抽取 |

---

## 三、采集链路

1. LLM 产出 `{ urls, fields, pagination }`
2. Fetch 通道选择（HTTP 优先）
3. Extract 按优先级尝试 patch → LLM
4. Quality Gate 失败 → 带原因 retry
5. 返回 JSON + `meta.extract_path`

---

## 四、学到的 Agent 知识

| 概念 | 实现 |
|------|------|
| **Planning Agent** | NL 任务 → 结构化 plan |
| **Quality Gate** | 抽取 Agent 的「critic」 |
| **确定性优先** | patch 先于 LLM |
| **多通道 Tool** | HTTP vs Playwright |

---

## 五、3 天精读计划

| 天 | 任务 |
|----|------|
| D1 | `crawlerAgentTaskPlanning.ts` |
| D2 | `qualityGate.ts` + smoke 脚本 |
| D3 | 读一个 `patches/sites/*.json` |

---

## 六、笔记区

""")

AGENTS["Lobster_Agent"] = doc("Lobster_Agent", """## 一、核心代码架构

```text
server/services/lobsterAgent.ts              # 主图（Plan-Act-Verify）
server/services/lobsterAgent/candidateSelectors.ts
server/services/lobsterAgent/verify/
server/routes/_ws.ts
server/routes/api/ready.get.ts   # 浏览器就绪（非 health）
```

---

## 二、模块精读

| 模块 | 文件 | 职责 |
|------|------|------|
| 主图 | `lobsterAgent.ts` | 步骤循环 |
| 候选 | `candidateSelectors.ts` | DOM 打分 |
| 校验 | `verify/` | 动作后状态 |
| 恢复 | recover 节点 | 遮罩、重试 |
| 合规 | compliance gate | 高风险 HITL |

---

## 三、GUI 任务链路

1. Plan：用户目标 → 可验证步骤列表
2. 每步：采候选 → 打分 → click/type
3. Verify：URL/DOM/文本是否达标
4. 失败 → Recover（关遮罩、换候选）
5. WS 推送步骤事件给前端/noVNC

---

## 四、学到的 Agent 知识

| 概念 | 实现 |
|------|------|
| **GUI Agent** | Playwright + LangGraph |
| **Verify/Recover** | 动作≠成功 |
| **Candidate Ranking** | 非单一 xpath |
| **Ready vs Health** | `/api/ready` 语义 |

---

## 五、3 天精读计划

| 天 | 任务 |
|----|------|
| D1 | `candidateSelectors.ts` |
| D2 | `verify/` 任选一策略 |
| D3 | 跟一条 WS 任务全链路 |

---

## 六、笔记区

""")

AGENTS["AI_admin_Agent"] = doc("AI_admin_Agent", """## 一、核心代码架构

```text
backend/app/main.py
backend/app/graph/state.py    # LangGraph
backend/app/tools/skills.py   # calendar/email/todo…
backend/app/core/internal_auth.py
```

---

## 二、模块精读

| 模块 | 文件 | 职责 |
|------|------|------|
| 图 | `graph/state.py` | tool 选择与执行 |
| 工具 | `tools/skills.py` | 办公 API 封装 |
| WS | `main.py` `/api/chat/ws` | 流式 tool 事件 |
| 鉴权 | `internal_auth.py` | 内网 token |
| 写门 | write gate | 高风险确认 |

---

## 三、办公请求链路

1. 用户：「明天 3 点提醒我开会」
2. LangGraph：LLM 选 `calendar_create` 类 tool
3. 执行 SQLite/逻辑 → 结构化结果
4. 汇总自然语言回复；写操作可走 HITL

---

## 四、学到的 Agent 知识

| 概念 | 实现 |
|------|------|
| **Tool-Using Agent** | 办公工具集 |
| **Function Calling** | schema 驱动选工具 |
| **HITL 信任边界** | `auto_confirm_risky` |
| **不幻觉业务数据** | 必须 invoke tool |

---

## 五、3 天精读计划

| 天 | 任务 |
|----|------|
| D1 | `tools/skills.py` 工具清单 |
| D2 | `graph/state.py` 节点 |
| D3 | Manager 调 admin 的 WS 抓包 |

---

## 六、笔记区

""")

AGENTS["Multimodal_Agent"] = doc("Multimodal_Agent", """## 一、核心代码架构

```text
backend/app/main.py
backend/app/agent.py
backend/app/processors/image_processor.py
backend/app/processors/video_processor.py
```

---

## 二、模块精读

| 模块 | 文件 | 职责 |
|------|------|------|
| 路由 | `agent.py` | 按 media type 分发 |
| 图像 | `image_processor` | VL、OCR |
| 视频 | `video_processor` | 关键帧+摘要 |
| 统一 | `/api/multimodal/unified` | 总管一次调用 |

---

## 三、理解链路

1. 请求带 `type: image|audio|video`
2. Processor 预处理（缩放、抽帧）
3. 调 DashScope VL/ASR
4. 返回结构化描述/转写（**不生成**音乐视频）

---

## 四、学到的 Agent 知识

| 概念 | 实现 |
|------|------|
| **MLLM 工程** | Processor 策略模式 |
| **理解 vs 生成** | 与 Music/Video 分工 |
| **BFF Unified API** | 总管单入口 |
| **降本** | 关键帧、OCR 分流 |

---

## 五、3 天精读计划

| 天 | 任务 |
|----|------|
| D1 | `agent.py` 路由 |
| D2 | `image_processor` |
| D3 | `unified` API 与 Manager executor |

---

## 六、笔记区

""")

AGENTS["Music_Agent"] = doc("Music_Agent", """## 一、核心代码架构

```text
backend/app/main.py
backend/app/llm.py
backend/app/midi_engine.py
backend/app/music_orchestrator.py
backend/app/remix_pipeline.py
```

---

## 二、模块精读

| 模块 | 文件 | 职责 |
|------|------|------|
| 意图 | `llm.py` | NL → 作曲 JSON |
| MIDI | `midi_engine.py` | music21 校验 |
| 渲染 | `music_orchestrator.py` | FluidSynth |
| BGM | `main.py` `/api/music/generate-bgm` | 供 Video 调用 |
| 重混 | `remix_pipeline.py` | 多阶段 |

---

## 三、作曲链路

1. LLM 输出调性、速度、乐器结构
2. 生成 MIDI → music21 规则校验
3. SoundFont 渲染 WAV/MP3
4. 可选 LLM Judge → refine

---

## 四、学到的 Agent 知识

| 概念 | 实现 |
|------|------|
| **神经+符号** | LLM + MIDI 中间表示 |
| **Structured Output** | 作曲 JSON schema |
| **LLM Judge** | 轻量 Reflexion |
| **跨 Agent** | BGM API 给 Video |

---

## 五、3 天精读计划

| 天 | 任务 |
|----|------|
| D1 | `llm.py` + `midi_engine.py` |
| D2 | 听一条生成链路日志 |
| D3 | Video `bgm_client.py` 反向看调用 |

---

## 六、笔记区

""")

AGENTS["Video_Agent"] = doc("Video_Agent", """## 一、核心代码架构

```text
backend/app/graph.py       # LangGraph 主图
backend/app/wan_video.py   # 万相异步
backend/app/llm_video.py   # 分镜 LLM
backend/app/bgm_client.py  # 调 Music Agent
```

---

## 二、模块精读

| 模块 | 文件 | 职责 |
|------|------|------|
| 图 | `graph.py` | director→wan→qa→bgm→mux |
| 万相 | `wan_video.py` | 提交+轮询 |
| 分镜 | `llm_video.py` | shot prompt |
| BGM | `bgm_client.py` | HTTP 调 Music |
| 产物 | `/api/video/out/` | 静态托管 |

---

## 三、成片链路

1. Director LLM：叙事结构
2. 每镜 Wan 文生视频（异步）
3. QA 节点：不合格 conditional retry
4. Music BGM → ffmpeg mux
5. WS 推节点进度

---

## 四、学到的 Agent 知识

| 概念 | 实现 |
|------|------|
| **长链路 LangGraph** | 多 LLM + 外部 API 节点 |
| **异步轮询** | 云视频任务 |
| **QA Retry** | conditional edge |
| **Multi-Agent 编排** | Video orchestrates Music |

---

## 五、3 天精读计划

| 天 | 任务 |
|----|------|
| D1 | `graph.py` 节点列表 |
| D2 | `wan_video.py` 轮询 |
| D3 | 完整 WS `type: generate` |

---

## 六、笔记区

""")

AGENTS["AI_Agent"] = doc("AI_Agent", """## 一、核心代码架构

```text
backend/app/main.py
backend/app/pipeline_stream.py
backend/app/local_lipsync.py
services/lipsync/server.py   # Ultralight 微服务
frontend/                    # 展示与 WS 客户端
```

---

## 二、模块精读

| 模块 | 文件 | 职责 |
|------|------|------|
| 流式管线 | `pipeline_stream.py` | ASR→LLM→TTS→lip |
| 对口型 | `local_lipsync.py` | 适配器模式 |
| 万相 S2V | `wan_s2v.py` | 云端口型视频 |
| 缓存 | `assets/` | utterance 复用 |
| 微服务 | `services/lipsync/` | GPU 进程隔离 |

---

## 三、语音对话链路

1. 音频 chunk → ASR partial
2. LLM stream 回复
3. TTS 音频 chunk
4. Lip-sync 模式分支（假口型/Ultralight/S2V）
5. WS 事件：`asr`/`llm`/`tts`/`video`

---

## 四、学到的 Agent 知识

| 概念 | 实现 |
|------|------|
| **Streaming Pipeline** | 多阶段 WS |
| **Adapter 模式** | 可插拔 lip-sync |
| **Utterance Cache** | 降延迟与成本 |
| **微服务拆分** | GPU 对口型独立 |

---

## 五、3 天精读计划

| 天 | 任务 |
|----|------|
| D1 | `pipeline_stream.py` 事件顺序 |
| D2 | 跑 text-only 对话 |
| D3 | `LIP_SYNC_MODE=local_ultralight` 三路对比 |

---

## 六、笔记区

""")

AGENTS["Companion_Agent"] = doc("Companion_Agent", """## 一、核心代码架构

```text
backend/app/graph.py
backend/app/emotions.py
backend/app/main.py
frontend/src/components/VrmModel.tsx
data/presets.json
```

---

## 二、模块精读

| 模块 | 文件 | 职责 |
|------|------|------|
| 图 | `graph.py` | prepare→llm→parse |
| 情绪 | `emotions.py` | `(action)` → VRM 状态 |
| 人设 | `presets.json` | 六维性格 |
| 渲染 | `VrmModel.tsx` | three-vrm |

---

## 三、对话链路

1. `session_start` 选 preset → system prompt
2. LLM Character 模型生成带 `(action)` 文本
3. `parse` 节点抽 action → `avatar_state` WS
4. 前端 VRM 混合表情

---

## 四、学到的 Agent 知识

| 概念 | 实现 |
|------|------|
| **Character LLM** | 千问 RP 模型 |
| **结构化 Parse 层** | 文本→UI 状态 |
| **Persona 参数化** | JSON preset |
| **呈现解耦** | 后端 parse / 前端 VRM |

---

## 五、3 天精读计划

| 天 | 任务 |
|----|------|
| D1 | `presets.json` + system 拼装 |
| D2 | `emotions.py` |
| D3 | WS `avatar_state` 对照 UI |

---

## 六、笔记区

""")

AGENTS["Tavern_Agent"] = doc("Tavern_Agent", """## 一、核心代码架构

```text
backend/app/catalog.py
backend/app/matrix.py
backend/app/chat_service.py
backend/app/prompts.py
backend/app/image_service.py
```

---

## 二、模块精读

| 模块 | 文件 | 职责 |
|------|------|------|
| 目录 | `catalog.py` | 角色/酒类 SSOT |
| 矩阵 | `matrix.py` | BehaviorParams 五维 |
| 对话 | `chat_service.py` | 调 LLM |
| Prompt | `prompts.py` | 向量→system |
| 插画 | `image_service.py` | 可选生图 |

---

## 三、对话链路

1. `GET /api/matrix/{character}/{wine}`
2. `prompts.py` 把五维向量写进 system
3. LLM 生成角色口吻回复
4. 换 wine 同一 character 语气变化

---

## 四、学到的 Agent 知识

| 概念 | 实现 |
|------|------|
| **规则+LLM** | 矩阵算参数，LLM 生成 |
| **参数化 Persona** | 非长 prompt 堆砌 |
| **Catalog API** | 游戏式内容 SSOT |

---

## 五、3 天精读计划

| 天 | 任务 |
|----|------|
| D1 | `matrix.py` + catalog API |
| D2 | 同角色换两种 wine 对比 |
| D3 | `prompts.py` 模板

---

## 六、笔记区

""")

AGENTS["Manage-platform_Agent"] = doc("Manage-platform_Agent", """## 一、核心代码架构

```text
docker-compose.agents-lan.yml
backend/app/main.py
backend/app/agent_config.py
backend/app/internal_agents.py
backend/app/capability_models.py
frontend/src/components/AgentConfigPanel.jsx
```

---

## 二、模块精读

| 模块 | 文件 | 职责 |
|------|------|------|
| Compose | `docker-compose.agents-lan.yml` | 11~20 容器 |
| 能力层 | `capability_models.py` | CAP_* SSOT |
| 配置 | `agent_config.py` | 模型下发 |
| 端点 | `internal_agents.py` | 内网 registry |
| 控制台 | `AgentConfigPanel.jsx` | 运维 UI |

---

## 三、部署与同步链路

1. `.env.agents-lan` 填 LAN_HOST、Key、Token
2. `docker compose up` 起标准栈
3. Manager `agentPlatformSync.ts` 拉端点
4. 控制台改 CAP → sync → 各 Agent `.env`

---

## 四、学到的 Agent 知识

| 概念 | 实现 |
|------|------|
| **Multi-Service 部署** | Compose 编排 |
| **配置 SSOT** | 7 层 CAP |
| **控制面/数据面** | Platform vs Agent |
| **Health vs Ready** | 分层探活 |
| **内网治理** | CLAWHIVE_INTERNAL_TOKEN |

---

## 五、3 天精读计划

| 天 | 任务 |
|----|------|
| D1 | 标准栈 up + 健康检查 |
| D2 | 控制台改一个模型验证 |
| D3 | 读 `internal_agents.py` + Manager sync |

---

## 六、笔记区

""")


def main() -> None:
    index_lines = [
        "# 本地 Agent 知识索引（勿提交 Gitee）",
        "",
        "> 各 Agent 目录下 `Agent知识-本地.md` 为核心实现精读；`学习指南.md` 为概念导读。均已 gitignore。",
        "",
        "| Agent | 本地精读 |",
        "|-------|----------|",
    ]
    for folder, content in AGENTS.items():
        dest = os.path.join(ROOT, folder, DEST)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, "w", encoding="utf-8", newline="\n") as f:
            f.write(content)
        print(f"Wrote {dest}")
        index_lines.append(f"| {folder} | [`{folder}/Agent知识-本地.md`](../{folder}/Agent知识-本地.md) |")

    local_dir = os.path.join(ROOT, "local-learning")
    os.makedirs(local_dir, exist_ok=True)
    index_path = os.path.join(local_dir, "README.md")
    with open(index_path, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(index_lines) + "\n")
    print(f"Wrote {index_path}")


if __name__ == "__main__":
    main()
