import type { McpToolDescriptor } from '#agent-shared/mcpJsonRpc'

export const LOBSTER_GUI_MCP_TOOLS: McpToolDescriptor[] = [
  {
    name: 'run_browser_task',
    description: '执行浏览器自动化任务（classic/mcp/stagehand auto 路由）',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string' },
        start_url: { type: 'string' },
        engine_hint: { type: 'string', enum: ['auto', 'mcp', 'stagehand', 'classic', 'desktop', 'mobile'] },
        storage_profile: { type: 'string' },
        timeout_ms: { type: 'number' },
        /** OpenClaw 式 Workflow Macro id（workflows/*.json） */
        workflow_id: { type: 'string' },
        workflow_args: { type: 'object' },
        manager_task: { type: 'object' },
        manager_task_envelope_v2: { type: 'string' },
        handoff_context: { type: 'string', enum: ['initial', 'post_human_confirm'] },
        browser_profile: { type: 'string', enum: ['managed', 'user', 'auto'] },
      },
      required: ['task'],
    },
  },
  {
    name: 'run_desktop_task',
    description: '执行 Windows 桌面原生应用任务（engine=desktop · Windows-MCP sidecar）',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string' },
        target_app: { type: 'string', description: '目标应用名，如 Notepad / 记事本' },
        engine_hint: { type: 'string', enum: ['desktop', 'auto'] },
        timeout_ms: { type: 'number' },
        manager_task: { type: 'object' },
        manager_task_envelope_v2: { type: 'string' },
      },
      required: ['task'],
    },
  },
  {
    name: 'run_android_task',
    description: '执行 Android 设备任务（engine=mobile · ADB / Android MCP sidecar）',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string' },
        target_app: { type: 'string', description: '目标 App 包名或显示名，如 微信 / com.tencent.mm' },
        engine_hint: { type: 'string', enum: ['mobile', 'auto'] },
        timeout_ms: { type: 'number' },
        manager_task: { type: 'object' },
        manager_task_envelope_v2: { type: 'string' },
      },
      required: ['task'],
    },
  },
  {
    name: 'browser_snapshot',
    description: '获取页面无障碍树快照（Playwright MCP）或已完成 run 的截图',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        run_id: { type: 'string' },
      },
    },
  },
  {
    name: 'import_session',
    description: '导入 cookies 到 storage profile（登录态复用）',
    inputSchema: {
      type: 'object',
      properties: {
        storage_profile: { type: 'string' },
        cookies: { type: 'array', items: { type: 'object' } },
        start_url: { type: 'string' },
      },
      required: ['storage_profile', 'cookies'],
    },
  },
  {
    name: 'resolve_run_confirm',
    description: '向进行中的 Lobster run 回传人工确认（总管 poll 路径经此桥接 in-run confirm）',
    inputSchema: {
      type: 'object',
      properties: {
        run_id: { type: 'string' },
        confirm_id: { type: 'string' },
        ok: { type: 'boolean' },
      },
      required: ['run_id', 'confirm_id'],
    },
  },
  {
    name: 'health',
    description: 'Lobster GUI MCP · Playwright MCP · Desktop MCP · Android 探活',
    inputSchema: { type: 'object', properties: {} },
  },
]
