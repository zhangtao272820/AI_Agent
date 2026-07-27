import type { McpToolDescriptor } from '#agent-shared/mcpJsonRpc'

export function isCodeMcpServerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.CODE_MCP_SERVER ?? '0').trim() === '1'
}

export const CODE_ASSIST_MCP_TOOLS: McpToolDescriptor[] = [
  {
    name: 'run_code_task',
    description: '执行 Code Agent 任务（compute/inspect/edit/script；compute 走 MCP 主路径）',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        task_kind: { type: 'string', enum: ['compute', 'inspect', 'edit', 'script', 'auto'] },
        manager_task_envelope_v2: { type: 'string' },
        manager_task: { type: 'object' },
        thread_id: { type: 'string' },
      },
      required: ['message'],
    },
  },
  {
    name: 'read_file',
    description: '读取仓库内文件（相对路径）',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        max_chars: { type: 'number' },
      },
      required: ['path'],
    },
  },
  {
    name: 'apply_patch',
    description: '受控写文件（需 WRITE_TOOL_ENABLED=1）',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
        expected_sha256: { type: 'string' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'get_repo_map',
    description: '生成 Repo Map 上下文（tree-sitter + PageRank，供外部 IDE/MCP 客户端注入）',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string' },
        hint_files: { type: 'array', items: { type: 'string' } },
        root: { type: 'string' },
        tokens: { type: 'number' },
      },
    },
  },
  {
    name: 'validate_project',
    description: '运行 lint/typecheck/test 质量校验（quick=typecheck，full=lint+typecheck+test）',
    inputSchema: {
      type: 'object',
      properties: {
        level: { type: 'string', enum: ['quick', 'full'] },
        root: { type: 'string' },
        timeout_ms: { type: 'number' },
      },
    },
  },
  {
    name: 'export_facts_csv',
    description: '将结构化 facts 导出为 .data/exports/*.csv',
    inputSchema: {
      type: 'object',
      properties: {
        facts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              value: {},
              source: { type: 'string' },
              agent: { type: 'string' },
            },
            required: ['key'],
          },
        },
        name: { type: 'string' },
      },
      required: ['facts'],
    },
  },
  {
    name: 'list_scripts',
    description: '列出 package.json 中可用的 npm scripts',
    inputSchema: {
      type: 'object',
      properties: {
        root: { type: 'string' },
      },
    },
  },
  {
    name: 'run_script',
    description: '运行 package.json script（需 COMMAND_TOOL_ENABLED=1）',
    inputSchema: {
      type: 'object',
      properties: {
        script: { type: 'string' },
        args: { type: 'array', items: { type: 'string' } },
        timeout_ms: { type: 'number' },
      },
      required: ['script'],
    },
  },
  {
    name: 'run_tests',
    description: '运行 npm test（或指定 test script）',
    inputSchema: {
      type: 'object',
      properties: {
        script: { type: 'string', default: 'test' },
        timeout_ms: { type: 'number' },
      },
    },
  },
  {
    name: 'health',
    description: 'Code Assist MCP 服务状态',
    inputSchema: { type: 'object', properties: {} },
  },
]
