# AI Admin Agent

> **学习文档**：[入门](../docs/Agent学习指南-入门版.md) · [进阶](../docs/Agent学习指南-进阶版.md) · [Admin 专篇](学习指南.md)  
> **升级路线图**：[AI_admin_Agent 升级评估与优先级](../docs/AI_admin_Agent升级评估与优先级.md)（含 [§十 国内 Skill/MCP 扩展](../docs/AI_admin_Agent升级评估与优先级.md#十国内-skill--mcp-能力扩展路线图)）

基于 **FastAPI（Python）+ React（Vite）+ LangGraph** 的个人助理型 Agent。它提供任务、日历、笔记、通讯录、邮件分类与回复等办公能力，支持 HTTP 聊天和 WebSocket 流式交互，并可由 Manager Agent 作为可信编排层传入部分自动确认参数。

本目录位于单体仓库 `AI_admin_Agent/` 中，对应平台编排里的 `ai_admin_agent` 服务，默认端口通常为 **13105**。

## 项目定位（面试版）

AI Admin Agent 适合展示“工具型个人助理”如何落地。它不是单纯的聊天机器人，而是把办公能力封装成工具，再由图状态机驱动调用，最后把结果回传给前端或总管编排。

## 技术栈与实现方式

- **后端**：`FastAPI`、`SQLAlchemy`、`LangGraph`
- **前端**：`React 19`、`Vite`、`Tailwind CSS`
- **模型接入**：`LangChain` / OpenAI 兼容接口
- **通信**：HTTP API、WebSocket

## 面试者建议：先理解什么

1. **为什么要把能力拆成 tools**
   - 日历、邮件、待办、联系人都属于明确领域能力
   - 工具化后更容易控制和审计

2. **为什么前后端可以分开也可以合并部署**
   - 前端是独立 SPA
   - 后端可以在构建后托管前端静态资源

3. **为什么需要 WebSocket**
   - 办公助理场景经常需要流式反馈和中间步骤展示

4. **为什么要允许可信编排层传参**
   - 某些场景由 Manager 统一确认后再继续执行，更符合业务流程

## 如何实现这个 Agent

推荐按这个路径理解：

1. **先做基础聊天接口**
   - 让后端能响应同步对话

2. **把办公能力封装成工具**
   - 日历、邮件、通讯录、待办分别做成 tools

3. **引入 LangGraph**
   - 用图组织“理解 -> 调用工具 -> 汇总回复”

4. **增加 WebSocket 流式输出**
   - 让前端看到思考和步骤

5. **增加前端管理界面**
   - 方便查看任务、消息和工具结果

## 目录结构速览

- `backend/app/main.py`：路由、WebSocket、聊天主入口
- `backend/app/graph/state.py`：Agent 图定义
- `backend/app/tools/skills.py`：工具定义
- `backend/app/core/`：配置、LLM、令牌控制、时间工具
- `backend/app/db/`：数据库会话与模型
- `frontend/`：React 管理台和聊天 UI

## 快速开始

### 验证（批次 0～2 smoke）

```bash
cd AI_admin_Agent/backend
python scripts/smoke_batch0.py
python scripts/smoke_batch1.py
python scripts/smoke_batch2.py
python scripts/smoke_batch3.py
python scripts/smoke_batch4.py
python scripts/smoke_batch5.py
```

### 后端

```bash
cd AI_admin_Agent/backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 13105
```

### 前端

```bash
cd AI_admin_Agent/frontend
npm install
npm run dev
```

## 环境变量

常见配置包括：

- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `OPENAI_MODEL`
- 数据库相关配置

## 面试常问点

### 为什么要有工具层

因为个人助理不是一个纯文本模型，而是一个可以操作实际业务对象的系统。工具层让能力边界更清晰，也更利于审计。

### 为什么要做流式

因为用户更关心“系统现在做到哪一步了”，而不是只看最后答案。流式输出能显著改善交互体验。

### 如何保证安全

- 对高风险操作保留确认
- 对邮件和联系人做最小权限控制
- 对外暴露接口时加鉴权

## 能力边界

- **适合**：办公协助、任务管理、邮件分类、日程和联系人查询
- **不适合**：无约束的公网助理、未经授权的敏感数据操作

## Docker / 平台编排

在 `Manage-platform_Agent` 中，该服务默认映射为 **`13105:13105`**。

## 安全提示

- `auto_confirm_risky` 只能给可信编排层
- 不要把真实 `.env` 提交到仓库
- 数据库和邮件权限必须最小化

## 常见问题

- **WS 403**：检查 CORS 和反向代理配置
- **前端 404**：确认已构建前端并正确挂载静态目录
- **工具调用失败**：检查数据库和模型配置