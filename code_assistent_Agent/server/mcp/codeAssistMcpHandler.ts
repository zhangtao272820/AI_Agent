/**
 * code-assist MCP export：读/写仓库、跑脚本与测试。
 */
import { readText, writeText } from '../services/fileSystem'
import { runSandboxNpmScript } from '../utils/sandbox_runner'
import { listPackageScripts } from '../utils/packageScripts'
import { buildCodeContext } from '../utils/buildCodeContext'
import { collectValidationDiagnostics } from '../utils/validateDiagnostics'
import { exportFactsToCsv } from '../utils/factsExport'
import type { StructuredUpstreamFact } from '../utils/manager_task'
import { getCodeAgentEnv } from '../utils/code_agent_env'
import { resolveCodeExecutionPlan } from '../utils/code_execution'
import { runComputeChat, shouldSkipManagerComputeOverhead } from '../utils/code_compute'
import { buildFullExperienceContext } from '../utils/code_learning'
import { formatInspectStrategyHint, resolvePromptAbVariant } from '../utils/code_prompt_ab_router'
import { applyPlatformRuntimeOverrides } from '../utils/platform_config'
import { mergeOpenAiRuntimeSecrets } from '../utils/runtime_secrets'
import { handleAgentChat } from '../services/agent'
import {
  mcpErr,
  mcpOk,
  mcpTextResult,
  parseMcpToolCallParams,
  type McpJsonRpcRequest,
} from '#agent-shared/mcpJsonRpc'
import { CODE_ASSIST_MCP_TOOLS, isCodeMcpServerEnabled } from './codeAssistMcpSchema'

export { isCodeMcpServerEnabled, CODE_ASSIST_MCP_TOOLS }

const TOOLS = CODE_ASSIST_MCP_TOOLS

async function readFileTool(args: Record<string, unknown>) {
  const p = String(args.path ?? '').trim()
  if (!p) throw new Error('path 必填')
  const max = Number(args.max_chars ?? 80_000)
  const text = await readText(p, Number.isFinite(max) ? max : 80_000)
  return { path: p, content: text }
}

async function applyPatchTool(args: Record<string, unknown>) {
  const env = getCodeAgentEnv()
  if (!env.writeToolEnabled) throw new Error('WRITE_TOOL_ENABLED=0')
  const p = String(args.path ?? '').trim()
  const content = String(args.content ?? '')
  if (!p) throw new Error('path 必填')
  const meta = await writeText({
    path: p,
    content,
    expectedSha256: String(args.expected_sha256 ?? '').trim() || undefined,
  })
  return { path: p, ...meta }
}

async function validateProjectTool(args: Record<string, unknown>) {
  const level = String(args.level ?? 'quick').trim() === 'full' ? 'full' : 'quick'
  const root = args.root ? String(args.root) : undefined
  const timeoutMs = Number(args.timeout_ms ?? getCodeAgentEnv().commandTimeoutMs)
  const entries = await listPackageScripts(root)
  const available = new Set(entries.map((e) => e.name))
  const order = level === 'full' ? ['lint', 'typecheck', 'test'] : ['typecheck']
  const scripts = order.filter((s) => available.has(s))
  const results: Array<{ script: string; ok: boolean; output: string }> = []
  for (const script of scripts) {
    const r = await runSandboxNpmScript({
      script,
      cwd: root,
      timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : undefined,
    })
    const output = `${r.stdout || ''}\n${r.stderr || ''}`.trim()
    results.push({ script, ok: r.ok, output: output.slice(0, 8000) })
    if (!r.ok) break
  }
  return {
    ok: results.every((r) => r.ok),
    level,
    scripts,
    results,
    diagnostics: collectValidationDiagnostics({ results }),
  }
}

async function getRepoMapTool(args: Record<string, unknown>) {
  const env = getCodeAgentEnv()
  const hintFiles = Array.isArray(args.hint_files) ? args.hint_files.map(String) : []
  const context = await buildCodeContext({
    root: args.root ? String(args.root) : undefined,
    question: args.question ? String(args.question) : undefined,
    hintFiles,
    tokenBudget: Number(args.tokens ?? env.repoMapTokenBudget),
    maxFiles: env.repoMapMaxFiles,
  })
  return { context, length: context.length, enabled: env.repoMapEnabled }
}

async function runScriptTool(args: Record<string, unknown>, scriptDefault = 'test') {
  const env = getCodeAgentEnv()
  if (!env.commandToolEnabled) throw new Error('COMMAND_TOOL_ENABLED=0')
  const script = String(args.script ?? scriptDefault).trim()
  const timeoutMs = Number(args.timeout_ms ?? env.commandTimeoutMs)
  const result = await runSandboxNpmScript({
    script,
    args: Array.isArray(args.args) ? args.args.map(String) : undefined,
    timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : env.commandTimeoutMs,
  })
  return result
}

async function runCodeTaskTool(args: Record<string, unknown>) {
  const message = String(args.message ?? '').trim()
  if (!message) throw new Error('message 必填')
  const plan = resolveCodeExecutionPlan({
    message,
    manager_task_envelope_v2: args.manager_task_envelope_v2 as string | Record<string, unknown> | null | undefined,
    managerTask: args.manager_task as Record<string, unknown> | null | undefined,
  })

  if (plan.taskKind === 'inspect' || plan.taskKind === 'edit' || plan.taskKind === 'script') {
    const chunks: string[] = []
    const toolEvents: Array<{ tool: string; status?: string }> = []
    let artifacts: Record<string, unknown> = {}
    await handleAgentChat(
      {
        threadId: String(args.thread_id ?? 'manager-mcp-code').trim() || 'manager-mcp-code',
        message: plan.question,
        mode: plan.taskKind === 'edit' ? 'refactor' : 'auto',
        root: args.root ? String(args.root) : undefined,
        manager_task_envelope_v2: args.manager_task_envelope_v2,
        managerTask: args.manager_task,
        agent_mode: plan.taskKind === 'edit' ? 'edit' : plan.taskKind === 'inspect' ? 'ask' : 'agent',
      },
      (event) => {
        if (event?.type === 'delta' && event.payload) chunks.push(String(event.payload))
        if (event?.type === 'tool_end' && event.tool) {
          toolEvents.push({ tool: String(event.tool), status: event.status ? String(event.status) : undefined })
        }
        if (event?.type === 'agent_edit_preview') {
          artifacts = {
            files_changed: event.files,
            diff_stat: event.diff_stat,
            unified_diff: event.unified_diff,
            branch: event.branch,
          }
        }
        if (event?.type === 'meta' && event.payload) {
          artifacts = {
            ...artifacts,
            validate_ok: event.payload.validate_ok,
            files_changed: event.payload.files_touched ?? artifacts.files_changed,
            completion_criteria: event.payload.completion_criteria,
          }
        }
      },
    )
    return {
      ok: chunks.length > 0 || toolEvents.length > 0,
      answer: chunks.join('').trim() || '(completed via tools)',
      task_kind: plan.taskKind,
      transport: 'mcp',
      from_manager: plan.fromManager,
      artifacts: { tools: toolEvents.slice(0, 24), ...artifacts },
    }
  }

  if (plan.taskKind !== 'compute') {
    return {
      ok: false,
      fallback: 'websocket',
      task_kind: plan.taskKind,
      reason: 'run_code_task MCP 未识别 task_kind',
    }
  }
  const runtime = mergeOpenAiRuntimeSecrets(await applyPlatformRuntimeOverrides({}))
  const apiKey = runtime.openaiApiKey
  const baseURL = runtime.openaiBaseUrl
  const model = runtime.openaiModel
  if (!apiKey || !baseURL || !model) throw new Error('Missing OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL')
  const sessionKey = String(args.thread_id ?? 'manager-mcp-code').trim() || 'manager-mcp-code'
  const skipOverhead = shouldSkipManagerComputeOverhead(plan)
  const promptAbVariant = skipOverhead ? 'control' : resolvePromptAbVariant(sessionKey, plan.question)
  const embeddingModel = String(runtime.openaiEmbeddingModel || 'text-embedding-v1')
  let experienceContext = ''
  if (!skipOverhead) {
    experienceContext = await buildFullExperienceContext({
      question: plan.question,
      task_kind: 'compute',
      sessionKey,
      abVariant: promptAbVariant,
      embeddingConfig: { openaiApiKey: apiKey, openaiBaseUrl: baseURL, embeddingModel },
    })
  }
  const result = await runComputeChat({
    apiKey,
    baseURL,
    model,
    question: plan.question,
    upstreamContext: plan.upstreamContext,
    upstreamFacts: plan.upstreamFacts,
    mustOutputs: plan.mustOutputs,
    experienceContext,
    inspectStrategyHint: skipOverhead ? '' : formatInspectStrategyHint(promptAbVariant, 'compute'),
    sendDelta: () => {},
    sendEvent: () => {},
  })
  return {
    ok: Boolean(result.text),
    answer: result.text,
    task_kind: 'compute',
    transport: 'mcp',
    from_manager: plan.fromManager,
  }
}

export async function handleCodeAssistMcpRequest(body: McpJsonRpcRequest) {
  if (!isCodeMcpServerEnabled()) {
    return mcpErr(body.id, -32000, 'MCP server disabled (CODE_MCP_SERVER=0)')
  }

  const method = String(body.method ?? '').trim()
  const params = (body.params ?? {}) as Record<string, unknown>

  if (method === 'initialize') {
    return mcpOk(body.id, {
      protocolVersion: '2024-11-05',
      serverInfo: { name: 'code-assist', version: '1.0.0' },
      capabilities: { tools: {} },
    })
  }
  if (method === 'ping') return mcpOk(body.id, {})
  if (method === 'tools/list') return mcpOk(body.id, { tools: TOOLS })

  if (method === 'tools/call') {
    const { name, args } = parseMcpToolCallParams(params)
    try {
      if (name === 'run_code_task') {
        return mcpOk(body.id, mcpTextResult(await runCodeTaskTool(args)))
      }
      if (name === 'read_file') return mcpOk(body.id, mcpTextResult(await readFileTool(args)))
      if (name === 'apply_patch') return mcpOk(body.id, mcpTextResult(await applyPatchTool(args)))
      if (name === 'export_facts_csv') {
        const facts = Array.isArray(args.facts) ? (args.facts as StructuredUpstreamFact[]) : []
        return mcpOk(
          body.id,
          mcpTextResult(exportFactsToCsv({ facts, name: String(args.name ?? '') })),
        )
      }
      if (name === 'get_repo_map') {
        return mcpOk(body.id, mcpTextResult(await getRepoMapTool(args)))
      }
      if (name === 'validate_project') {
        return mcpOk(body.id, mcpTextResult(await validateProjectTool(args)))
      }
      if (name === 'list_scripts') {
        const entries = await listPackageScripts(args.root ? String(args.root) : undefined)
        return mcpOk(body.id, mcpTextResult({ scripts: entries.map((e) => e.name), entries }))
      }
      if (name === 'run_script') return mcpOk(body.id, mcpTextResult(await runScriptTool(args)))
      if (name === 'run_tests') {
        const script = String(args.script ?? 'test').trim() || 'test'
        return mcpOk(body.id, mcpTextResult(await runScriptTool({ ...args, script }, script)))
      }
      if (name === 'health') {
        const env = getCodeAgentEnv()
        return mcpOk(body.id, mcpTextResult({
          service: 'code-assist',
          write_tool: env.writeToolEnabled,
          command_tool: env.commandToolEnabled,
          run_command: env.runCommandEnabled,
        }))
      }
      return mcpErr(body.id, -32601, `unknown tool: ${name}`)
    } catch (e: unknown) {
      return mcpErr(body.id, -32000, String((e as Error)?.message ?? e ?? 'tool failed'))
    }
  }

  return mcpErr(body.id, -32601, `unknown method: ${method}`)
}

