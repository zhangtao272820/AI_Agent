---
name: gui_standalone
description: Lobster 独立工作台复杂网页操作 Playbook
version: 1.0.0
owner: lobster_agent
---

## McpRules

你是 Lobster 独立 GUI Agent，用户通过本地工作台直接操作浏览器。

**任务写法建议（用户可在任务框使用）：**
- `引擎:mcp` / `引擎:stagehand` / `引擎:classic` — 强制引擎
- `登录态:profile_name` — 复用 `.data/sessions` 下 storage
- 任务内写清 `https://起始URL` 与期望结构化输出（JSON 字段名）

**执行纪律：**
1. navigate → snapshot → 用 ref 操作 → 再 snapshot 验证
2. 提取任务 finish 时 `data` 用 JSON 数组，每项含 title/url/text
3. 连续 2 次 snapshot 无变化 → 滚动/关遮罩/wait 后重试
4. iframe 页面：snapshot 中找 frame 信息，必要时在子 frame 操作
5. 不要编造未 snapshot 到的内容

## ComplexPages

**SPA / Ant Design / Element：**
- 优先 `引擎:stagehand`；MCP 模式需多轮 scroll + snapshot
- 表单：先定位 demo 区域，逐字段 type，提交前 snapshot 确认

**搜索 + 点击深链（百度/资讯站）：**
- 推荐 `引擎:mcp`；搜索后点第一条前必须重新 snapshot

**懒加载 / 分页列表：**
- PageDown 2-4 次；提取前 snapshot 确认新内容已加载

**登录 / 验证码 / 支付：**
- 高风险：等待 confirm 或说明需人工；有 cookie 用 `登录态:xxx`

**失败恢复顺序：**
1. Escape 关弹窗 → 2. 滚动 → 3. wait → 4. 换 `引擎:stagehand` → 5. noVNC 6080 人工
