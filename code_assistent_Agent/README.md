# Code Assist Agent

> **学习文档**：[入门](../docs/Agent学习指南-入门版.md) · [进阶](../docs/Agent学习指南-进阶版.md) · [Code 专篇](学习指南.md)

基于 **Nuxt 4 + WebSocket + LangGraph** 的代码仓库智能助手。它面向“真改仓库”的场景，不只是聊天，而是通过代码浏览、语义搜索、静态分析、Bug 扫描、重构建议和 Diff 级编辑，把 AI 能力接到真实工程流程里。

本目录位于单体仓库 `code_assistent_Agent/` 中，对应平台编排里的 `code_assistent_agent` 服务，默认端口通常为 **13103**。

## 项目定位（面试版）

Code Assist Agent 的亮点在于它不是一个通用对话框，而是一个 **工程化 Coding Agent**：

- 能读仓库结构
- 能做语义检索
- 能给出修改建议
- 能展示 Diff
- 能受控写文件
- 能通过鉴权、限流、审计限制风险

非常适合面试时展示“如何把模型能力放进真实开发工作流”。

## 技术栈与实现方式

- **前端/全栈**：`Nuxt 4`、`Vue 3`、`Pinia`
- **编辑器**：`monaco-editor`
- **语法分析与索引**：`web-tree-sitter`、代码仓语义搜索相关服务
- **Agent 编排**：`LangGraph`、`@langchain/openai`
- **实时通信**：`ws`
- **安全**：`jose`、中间件限流与鉴权
- **测试**：`vitest`

## 面试者建议：先理解什么

1. **为什么要区分“读仓库”和“写仓库”**
   - 读操作用于理解上下文
   - 写操作必须受控，否则风险非常高

2. **为什么要有语义搜索**
   - 代码仓里不是所有相关内容都能靠全文匹配找到
   - 向量检索更适合找“概念相关”的符号和文件

3. **为什么要展示 Diff**
   - 让用户先确认修改范围
   - 便于审阅、回滚和沟通

4. **为什么要加鉴权和限流**
   - Agent 一旦能写文件，就必须有明确边界
   - 真实工程里不能把仓库修改能力完全暴露出去

## 如何实现这个 Agent

推荐按这个路径复现：

1. **文件树与仓库浏览**
   - 先做文件列表、Git 状态和基础读取

2. **静态分析与索引**
   - 把符号、依赖、文件关系梳理出来

3. **加语义搜索**
   - 用向量检索定位相关代码片段

4. **加 WS 流式对话**
   - 支持边分析边输出

5. **加写文件与 Diff 预览**
   - 只在确认后执行修改

6. **加安全中间件**
   - 鉴权、限流、审计日志都要补齐

## 目录结构速览

- `server/routes/_ws.ts`：WebSocket 主通道
- `server/api/*.ts`：文件树、Git 状态、写文件、向量搜索、分析等接口
- `server/services/agent.ts`：对话与工具编排入口
- `server/services/codeAnalyzer.ts`：代码分析
- `server/services/codeAnalyzer.ts` / `analysis.ts`：静态分析与 code smell 检测
- `server/services/bugDetector.ts`：Bug 识别
- `server/services/testGenerator.ts`：测试生成
- `server/middleware/00-rate-limit.ts`、`01-auth.ts`：限流与鉴权
- `components/`：文件树、Diff、Monaco 编辑器等 UI

## 快速开始

```bash
cd code_assistent_Agent
npm install
npm run dev
```

## 环境变量

常见配置包括模型相关参数和鉴权密钥，具体以 `nuxt.config.ts` 与 `.env.example` 为准。

## 面试常问点

### 为什么它比普通 Copilot 更工程化

因为它不仅生成代码，还能读取仓库、定位符号、展示 Diff、受控写盘，并且把安全控制前置。

### 如何防止模型乱改仓库

- 先读后写
- 写操作受鉴权控制
- 变更前展示 Diff
- 记录审计和回滚入口

### 为什么要做 NLU 回归

因为代码助手不仅要“会说”，还要“会路由”。如果意图识别不稳，后面所有工具调用都会跑偏。

## 能力边界

- **适合**：仓库理解、局部重构、测试建议、语义找码、受控文件编辑
- **不适合**：无仓库上下文的任意写盘、替代完整 CI/CD 和安全审计

## Docker / 平台编排

在 `Manage-platform_Agent` 中，该服务默认映射为 **`13103:13103`**。

## 安全提示

- 写文件能力必须放在受信环境中使用
- 不要把生产密钥写进仓库
- 未授权请求应直接拒绝

## 常见问题

- **WS 连不上**：检查 Nitro 的 websocket 配置和代理升级支持
- **向量搜不到**：确认索引是否构建成功
- **写文件失败**：检查鉴权、路径白名单和权限

## 文档

- 待办：[docs/Skill化升级计划.md](../docs/Skill化升级计划.md)（Code 章节）