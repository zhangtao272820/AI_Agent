# desktop-automation Skill（OpenClaw 类 · P2-C2）

> Windows 原生桌面自动化：经 Windows-MCP sidecar（UIA）操作记事本、资源管理器等

## 何时加载

- `task_kind` 为 `desktop_app`
- 用户任务含：记事本、Notepad、Excel、Word、桌面、资源管理器、Windows 应用
- 无 `start_url` 或 URL 非 http(s)

## 环境

| 变量 | 说明 |
|------|------|
| `LOBSTER_DESKTOP_MCP_ENABLED=1` | 启用 desktop 引擎（Win 宿主机） |
| `LOBSTER_DESKTOP_MCP_SERVERS` | JSON MCP 配置，默认 `uvx windows-mcp` |

Docker Linux 容器内默认关闭；桌面任务需在 Windows 宿主机运行 Lobster（或薄 Hands 侧车）。详见 [Docker与宿主机动手部署](../../doc/Docker与宿主机动手部署.md)。

## 执行规则

1. 先聚焦目标窗口（Notepad / 记事本 / Explorer）
2. 输入文本后读取窗口内容验证是否生效
3. 保存文件时确认路径（如桌面）并在 finish 中回报完整路径
4. 删除 / 格式化 / 关机 / 支付等高风险操作：说明风险并等待 confirm 或 finish 中止
5. 无法找到控件时：尝试 Alt+Tab / 窗口列表工具切换焦点

## 完成标准

- 记事本：文件内容包含目标文本且已保存（若用户要求保存）
- 打开应用：目标窗口可见且标题匹配
- 文件操作：finish 中给出路径或操作结果摘要

## 禁止

- 无确认执行删除、格式化、注册表修改
- 编造未执行过的桌面操作结果
