# Lobster Agent

> **学习文档**：[入门](../docs/Agent学习指南-入门版.md) · [进阶](../docs/Agent学习指南-进阶版.md) · [Lobster 专篇](学习指南.md)  
> **升级 / 协议（唯一入口）**：[Lobster升级SSOT](doc/Lobster升级SSOT.md) · [Docker 与宿主机动手](doc/Docker与宿主机动手部署.md) · [矩阵总表](../docs/Agent矩阵升级总路线图.md)（协议字段见 SSOT §4）

基于 **Nuxt 4 + Playwright + LangGraph** 的网页 GUI 自动化 Agent。平台编排里对应 **`gui` 能力** / 服务 `lobster_agent`，默认端口 **13108**。

## 项目定位（面试版）

Lobster Agent 适合展示“复杂网页自动化如何工程化”。它不是写死脚本，而是通过规划、执行、验证和恢复的闭环，让 Agent 在动态页面里持续推进任务。

这个项目特别适合面试时讲三件事：

- 如何让浏览器自动化更稳
- 如何处理失败和遮罩弹窗
- 如何让模型与执行器协作，而不是只会输出计划

## 技术栈与实现方式

- **框架**：`Nuxt 4`、`Vue 3`、`Nitro(h3)`
- **浏览器自动化**：`Playwright`
- **Agent 编排**：`LangGraph`
- **智能决策**：`LLM`（OpenAI / Qwen 兼容）
- **结构化约束**：`zod`
- **回归验证**：`scripts/regression-smoke.mjs`

## 面试者建议：先理解什么

1. **为什么 GUI 自动化比普通抓取复杂**
   - 页面状态会变化
   - 会有弹窗、遮罩、播放器和懒加载
   - 失败后还要能恢复

2. **为什么要有候选元素系统**
   - 模型不能直接“猜点击哪个元素”
   - 需要 locator、bbox、文本、链接等多种兜底

3. **为什么要做 verify / recover**
   - 动作成功不等于任务成功
   - 需要校验页面是否真的进入了下一步

4. **为什么要加风控 gate**
   - 自动化一旦能操作真实网页，风险会很高
   - 有些动作必须限制或确认

## 如何实现这个 Agent

推荐按这个路径理解：

1. **浏览器运行时管理**
   - 先把浏览器启动、复用和关闭跑通

2. **候选元素采集**
   - 把页面上可操作元素抓出来
   - 用打分逻辑挑出最可能的目标

3. **执行器拆分**
   - 点击、输入、关闭遮罩、抽取内容都拆成单独执行器

4. **验证与恢复**
   - 每次动作后检查页面状态
   - 如果失败，尝试恢复到可继续推进的状态

5. **接入人工接管和鉴权**
   - 高风险动作前保留确认
   - 管理接口加 token

## 目录结构速览

- `server/services/lobsterAgent.ts`：主编排入口
- `server/services/lobsterRuntime.ts`：浏览器运行时生命周期
- `server/services/lobsterAgent/`：候选、执行、验证、恢复、合规等模块
- `server/routes/_ws.ts`：WebSocket 控制通道
- `server/api/lobster/*`：启动、停止、状态、截图等接口
- `scripts/regression-smoke.mjs`：最小回归脚本

## 快速开始

```bash
npm install
npm run dev
```

## 环境变量

常见配置包括：

- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `LOBSTER_PLANNER_MODEL`
- `LOBSTER_DECISION_MODEL`
- `LOBSTER_VISION_MODEL`
- `LOBSTER_HEADLESS`
- `LOBSTER_ADMIN_TOKEN`

### Playwright MCP 执行引擎（推荐）

Lobster 现支持三种执行模式（`LOBSTER_EXECUTION_MODE`）：

| 模式 | 说明 |
|------|------|
| `classic` | 原 LangGraph + 内置 Playwright 候选/恢复流水线 |
| `mcp` | 官方 `@playwright/mcp` 工具链（无障碍树驱动，LLM 直接调工具） |
| `auto`（默认） | MCP 优先；探针失败或执行异常时自动回退 `classic` |

```bash
# 默认 auto：无需改配置即可尝试 MCP
LOBSTER_EXECUTION_MODE=auto
LOBSTER_MCP_ENABLED=1

# Docker / 无显示环境：先起独立 MCP HTTP 服务
npx -y @playwright/mcp@latest --port 8931 --headless
# 再配置 Lobster：
LOBSTER_MCP_URL=http://127.0.0.1:8931/mcp
```

探针：`GET /api/ready` 返回 `executionMode`、`engines`（classic/mcp/stagehand）、`mcp.ok`、`mcp.toolCount`。

引擎路由 · StepDecide · 总管联调见 [Lobster升级SSOT](doc/Lobster升级SSOT.md)。

本地验证 MCP 连接：

```bash
npm run smoke:mcp
```

完整示例见 [`.env.example`](.env.example)。

## 面试常问点

### 为什么它不是普通爬虫

因为它不是只抓数据，而是能完成页面交互任务。它需要感知页面状态、做下一步判断、失败恢复和人工接管。

### 为什么要拆执行器

拆分后更容易测试、复用和定位问题。点击、输入、抽取、关闭遮罩本来就是不同类型的动作。

### 如何提高鲁棒性

- 候选元素多级兜底
- 每步都做验证
- 失败时进入恢复分支
- 对高风险动作设置 gate

## 能力边界

- **适合**：简单国内网页（如菜鸟教程、百度、政府/资讯站）、搜索、点击、抽取、需要恢复的任务
- **不适合**：复杂 SPA 音乐/视频站、大规模静态采集、纯 API 数据获取

## 推荐测试站点

默认起始页为 [菜鸟教程](https://www.runoob.com/)（结构清晰、无需登录）。示例任务：

```
打开 https://www.runoob.com/ ，提取页面标题和第一个教程链接，输出 JSON 并结束。
```

其他可选：`https://www.baidu.com/`（搜索）、`https://www.gov.cn/`（资讯列表）。

## Docker / 平台编排

在 `Manage-platform_Agent` 中，该服务默认映射为 **`13108:13108`**，noVNC **`6080:6080`**。

**宿主桌面 / 登录态 Chrome / 是否打 exe**：见 [Docker 与宿主机动手部署](doc/Docker与宿主机动手部署.md)（容器只能做网页手；Win UIA 须宿主机 Hands 侧车）。

**Workflow Macro**：`workflows/*.json` + 总管 `workflow_id`；本地 `npm run smoke:workflow`。

## 安全提示

- 启用管理员 token 后，API 和 WS 都要带鉴权
- 浏览器会执行页面脚本，只能在可信目标上使用
- 不要将真实 `.env` 提交到仓库

## 常见问题

- **看不到浏览器窗口**：检查 `LOBSTER_HEADLESS`
- **任务卡住**：查看候选元素和恢复逻辑
- **鉴权失败**：检查 `LOBSTER_ADMIN_TOKEN` 和请求头