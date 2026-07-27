# Manager Agent

> **开源教程**：[入门](../docs/Agent学习指南-入门版.md) · [进阶](../docs/Agent学习指南-进阶版.md) · [Manager 专篇](学习指南.md) · [Star ⭐ 支持](https://gitee.com/assssshuhuhuh/agent/stargazers)

## 简历摘要（可直接写入项目经历）

- **项目**：多 Agent 协作「总管」— 统一 WebSocket 会话入口，语义路由与任务规划，调度 DB/RAG/代码/爬虫/办公/多模态/音乐/视频等 10+ 下游服务。
- **技术栈**：Nuxt 4、Nitro、LangGraph、OpenAI 兼容 LLM、Zod、LangSmith；自研向量记忆、Prompt/Planner 规则进化、策略金丝雀、全 Agent 健康探测。
- **职责亮点**：`probe → route → plan → execute → synthesize → critic` 状态机；人工确认与取消；经验回放与失败洞察驱动自进化；`/api/agents/registry` 与聊天页进化看板；媒体文件代理（音乐/视频 同源播放）。

---

基于 **Nuxt 4 + LangGraph + WebSocket** 的多 Agent 编排网关。它不直接替代 DB、RAG、Code Assist、Extractor 等专业 Agent，而是负责统一会话、解析用户意图、路由到下游服务，并支持人工确认、取消运行与反馈采集。

**媒体协作**：`multimodal`（识图/语音/视频理解）、`music`（Music_Agent 作曲）、`video`（Video_Agent 文生视频）由总管直接 WebSocket/HTTP 调用，不再经多模态 Agent 转发。任务分配：**decompose（子句拆解，默认开）→ route → planner** 的 LLM 决定意图与步骤；关闭拆解：`MANAGER_CLAUSE_DECOMPOSE=0`。

本目录位于单体仓库 `Manager_Agent/` 中，对应平台编排里的 `manager_agent` 服务，默认端口通常为 **13106**。

## 项目定位（面试版）

Manager Agent 是整个多 Agent 系统的“总管层”。它展示的是 **编排能力**，不是单点能力：

- 维护会话状态
- 判断请求该交给哪个子 Agent
- 处理流式消息和中间事件
- 在高风险步骤前做人工确认
- 接入 LangSmith 做可观测性

面试时可以把它解释成“一个入口，多个专家”的调度中心。

## 协作姿态 vs 工作台模式

UI 上有两套**正交**开关，不要混为一谈：

| 开关 | 值 | 放哪里 | 作用 |
|------|-----|--------|------|
| **协作姿态** `collaborationPosture` | Ask / Plan / Agent / Debug | **对话输入区下拉**（Cursor 式） | 约束允许动作：Ask/Debug 只读；Plan 强制蓝图确认；Agent 按风险策略推进；Debug 需步证据才重验 |
| **工作台模式** `workbenchMode` | 对话 / 专业 | **顶栏** | 编排深度：对话可寒暄直连；专业走 PU-Stack 读题与完整编排 |

契约 SSOT：`server/utils/platform/collaborationPosture.ts`。对纯 RAG/DB 只读查询，Ask 与 Agent 看起来会很像——差异主要体现在写操作（admin/gui/code 落盘）与 Plan 停点。

## 技术栈与实现方式

- **框架**：`Nuxt 4`、`Nitro`
- **通信**：`WebSocket`，入口见 `server/api/manager-ws.ts`
- **Agent 编排**：`LangGraph`、`@langchain/openai`
- **入参校验**：`zod`
- **可观测性**：`langsmith`
- **辅助脚本**：`scripts/start-agents.js`、`scripts/nlu-metrics-report.mjs`

## 面试者建议：先理解什么

1. **编排层和专家层的边界**
   - Manager 只做路由和调度
   - 专业能力留给子 Agent

2. **为什么用 WebSocket**
   - 多轮对话、流式输出、确认/取消事件都更适合长连接

3. **为什么需要人工确认**
   - 真实业务里会有高风险操作
   - 编排层要能暂停并等待用户确认

4. **为什么要做可观测性**
   - 多 Agent 问题定位复杂
   - 需要追踪到每个节点和每次调用

## 如何实现这个 Agent

推荐按下面路径理解：

1. **单下游代理**
   - 先让 Manager 只代理一个子服务

2. **扩展成多路由**
   - 根据意图分发到 DB、RAG、Code、Extractor、AI Admin 等

3. **加入流式与状态机**
   - 用 WebSocket 处理 chat、resume、cancel、confirm 等事件

4. **加入人工确认与反馈**
   - 对高风险动作暂停
   - 记录反馈，方便回溯

5. **加入指标和追踪**
   - 通过 LangSmith / 指标脚本观察路由质量和稳定性

## 目录结构速览

- `server/api/manager-ws.ts`：WebSocket 协议入口
- `server/api/metrics.get.ts`：指标/健康接口
- `server/utils/managerGraph.ts`：LangGraph 构建与节点逻辑
- `server/utils/*`：各类子节点、路由、执行、修复、计划与文本处理
- `scripts/nlu-metrics-report.mjs`、`scripts/vector-reindex.mjs`：指标与向量重建
- `server/plugins/managerEvolutionCurator.ts`：可选后台进化 Curator

## 快速开始

```bash
cd Manager_Agent
npm install
npm run dev
```

## 自我进化（向量记忆 + Prompt 补丁 + 策略金丝雀）

- **向量召回**（默认开启）：experience/plan_outcome 写入 `.data/manager-memory-embeddings.jsonl`，路由/长期记忆用 embedding + Jaccard 混合排序。
- **会话用户画像**：`.data/manager-user-profiles.json`，按 `sessionId` 积累意图偏好与成功任务摘要，注入路由 longMemory。
- **Agent 注册表**：`server/utils/managerGraph.agentRegistry.ts`；`GET /api/agents/registry` 返回能力清单、端点与健康快照。
- **全 Agent 健康探测**：`tool_health` 覆盖 db～video；`MANAGER_TOOL_HEALTH_LIVE_PROBE=1` 时对 HTTP 服务做 `/api/health`；`down` 的 Agent 不会进入 `allowedAgents`。
- **Prompt 补丁**：失败洞察写入 `.data/manager-prompt-patches.shadow.json`；晋级到 `manager-prompt-patches.json` 后注入 router/planner。
- **策略金丝雀**：`MANAGER_POLICY_CANARY_PERCENT=5` 时约 5% 会话使用 `manager-policy.shadow.json`（按 sessionId 稳定分桶）。
- **Planner 硬规则**：`.data/manager-planner-rules.json`，`plan_lint` 强制执行；失败样本可进化 shadow 规则。
- **后台 Curator**：`MANAGER_EVOLUTION_CURATOR=1` 时定时 memory 治理 + Prompt/规则进化。
- **指标看板**：`GET /api/metrics` 含 `evolution`、`agentRegistry`、`toolHealth`、`policyCanary`；聊天页「进化看板」。
- **运维**（需 `MANAGER_OPS_TOKEN` + 头 `x-manager-ops-token`）：
  - `vector_reindex` — 重建向量索引
  - `prompt_shadow_diff` / `prompt_promote` / `prompt_evolve_force`
- 脚本：`npm run vector:reindex`（需本机 Manager 已启动且配置 token）

## 环境变量

复制 `.env.example` 为 `.env`，填写 `OPENAI_API_KEY` 与各子 Agent 地址即可。  
经验回放、向量记忆、Prompt/规划规则进化、策略自学习、工具健康探测等**默认开启**（关闭时设 `0`），不必逐项写入。

常用可选项：`MANAGER_MODEL_*`（分阶段模型）、`MANAGER_EXECUTION_MODE_OVERRIDE` / `MANAGER_VOTE_TARGETS`、`MANAGER_POLICY_CANARY_PERCENT`、`MANAGER_OPS_TOKEN`、`MANAGER_EVOLUTION_CURATOR=1`。  
Docker 媒体代理可设 `MUSIC_AGENT_HTTP_URL`、`VIDEO_AGENT_HTTP_URL`（见 `.env.example` 注释）。

## 面试常问点

### 为什么总管不直接实现每个子能力

因为总管的职责是调度和编排。把能力拆给专业 Agent，能让系统更易维护、更容易扩展，也更符合工程分层。

### 为什么要用 LangGraph

因为多 Agent 编排不是单次函数调用，而是一个有分支、回环、人工确认和失败恢复的状态机。

### 如何避免路由错乱

- 通过意图分类和路由规则分流
- 用状态机限制节点跳转
- 通过日志和指标回看错误样本

## 能力边界

- **适合**：统一聊天入口、多 Agent 路由、人工确认、任务编排
- **不适合**：在总管进程里直接做重型爬取、重型文件处理或复杂 GUI 自动化

## Docker / 平台编排

在 `Manage-platform_Agent` 中，该服务默认映射为 **`13106:13106`**。

## 安全提示

- WebSocket 暴露到公网时必须加鉴权和 TLS
- 高风险操作一定要保留确认步骤
- 不要让子 Agent 的密钥或内部 URL 泄露到前端

## 升级与运维文档

- **协作架构（Cursor 模式一/二期）**：[`doc/借鉴Cursor-Agent模式升级.md`](doc/借鉴Cursor-Agent模式升级.md)
- **协作认知与 Token 预算（三期）**：[`doc/协作认知与Token预算升级.md`](doc/协作认知与Token预算升级.md)
- **用户态回复与动手操作成熟化**：[`doc/用户态回复与动手操作成熟化升级.md`](doc/用户态回复与动手操作成熟化升级.md)
- **内部协作与子 Agent**：[`doc/内部协作与子Agent能力升级.md`](doc/内部协作与子Agent能力升级.md)
- **内置 Agent 升级方案**（clean / visualize / report）：[`docs/内置Agent升级方案.md`](docs/内置Agent升级方案.md)
- **Skill 化升级计划**：[`docs/Skill化升级计划.md`](../docs/Skill化升级计划.md)
- **LAN 部署与运维**：[`Manage-platform_Agent/README.md`](../Manage-platform_Agent/README.md)

## 常见问题

- **连不上子 Agent**：检查 `nuxt.config.ts` 里的 `runtimeConfig.agents.*Url`
- **LangSmith 没数据**：确认追踪开关和 API Key
- **路由总是错**：检查 `server/utils/managerGraph.*` 中的意图与节点规则