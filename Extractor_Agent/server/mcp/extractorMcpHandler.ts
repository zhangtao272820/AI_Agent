/**
 * MCP 兼容 JSON-RPC：暴露 scrape_url / extract_task，与内部 fetch + crawl 管道共用。
 */
import { fetchHtml, extractTitleFromHtml } from '../services/crawlerAgentRuntime'
import { fetchViaCloudScrape } from '../services/cloudScrape'
import { executeExtractRun } from '../utils/crawl_run'
import { buildCrawlerAgentResult } from '../utils/agent_result'
import { getExtractorAgentEnv } from '../utils/extractor_agent_env'

type JsonRpcReq = {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
}

const TOOLS = [
  {
    name: 'scrape_url',
    description: '抓取单个 URL，返回 title 与 html 摘要（HTTP → 云抓取）',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'HTTPS URL' },
        prefer_cloud: { type: 'boolean', description: '优先云抓取' },
      },
      required: ['url'],
    },
  },
  {
    name: 'extract_task',
    description: '执行完整 Extractor 采集任务（兼容总管 task 文本 + manager_task_json）',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string' },
        manager_task_json: { type: 'string' },
        max_items: { type: 'number' },
      },
      required: ['task'],
    },
  },
] as const

function ok(id: JsonRpcReq['id'], result: unknown) {
  return { jsonrpc: '2.0', id: id ?? null, result }
}

function err(id: JsonRpcReq['id'], code: number, message: string) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } }
}

async function scrapeUrlTool(args: Record<string, unknown>, config: any) {
  const url = String(args.url ?? '').trim()
  if (!/^https?:\/\//i.test(url)) throw new Error('url 必须为 http(s)')

  const ctrl = new AbortController()
  const signal = ctrl.signal
  const preferCloud = args.prefer_cloud === true

  if (preferCloud && config?.mcp?.provider) {
    const cloud = await fetchViaCloudScrape(url, config, signal)
    if (cloud) return formatScrapeResult(cloud, 'cloud_scrape')
  }

  if (!preferCloud) {
    try {
      const html = await fetchHtml(url, config, signal)
      const title = extractTitleFromHtml(html)
      return formatScrapeResult({ url, finalUrl: url, title, html, networkJson: [] }, 'http')
    } catch {
      /* fall through */
    }
  }

  if (config?.mcp?.provider) {
    const cloud = await fetchViaCloudScrape(url, config, signal)
    if (cloud) return formatScrapeResult(cloud, 'cloud_scrape')
  }

  throw new Error('所有抓取通道均失败')
}

function formatScrapeResult(snap: { url: string; finalUrl: string; title: string; html: string }, channel: string) {
  return {
    channel,
    url: snap.url,
    final_url: snap.finalUrl,
    title: snap.title,
    html_length: snap.html.length,
    html_preview: snap.html.slice(0, 4000),
  }
}

async function extractTaskTool(args: Record<string, unknown>, config: any) {
  const task = String(args.task ?? '').trim()
  if (!task) throw new Error('task 不能为空')
  const maxItems = Number(args.max_items ?? 10)
  const result = await executeExtractRun({
    task,
    config,
    signal: AbortSignal.timeout(120_000),
    manager_task_json: String(args.manager_task_json ?? '').trim() || undefined,
    options: { maxItems: Number.isFinite(maxItems) ? maxItems : 10 },
    source: 'mcp',
  })
  const agentResult = buildCrawlerAgentResult({
    items: Array.isArray(result.items) ? result.items : [],
    outputContent: typeof result.output?.content === 'string' ? result.output.content : '',
    status: result.status,
    meta: (result.meta ?? {}) as Record<string, unknown>,
    stats: (result.stats ?? {}) as Record<string, unknown>,
    planNeedsLogin: Boolean((result.plan as any)?.needsLogin),
  })
  return { result, agentResult }
}

export async function handleExtractorMcpRequest(body: JsonRpcReq, config: any) {
  if (!getExtractorAgentEnv().enableMcpServer) {
    return err(body.id, -32000, 'MCP server disabled (EXTRACTOR_MCP_SERVER=0)')
  }

  const method = String(body.method ?? '').trim()
  const params = (body.params ?? {}) as Record<string, unknown>

  if (method === 'initialize') {
    return ok(body.id, {
      protocolVersion: '2024-11-05',
      serverInfo: { name: 'extractor-agent', version: '1.0.0' },
      capabilities: { tools: {} },
    })
  }

  if (method === 'tools/list') {
    return ok(body.id, { tools: TOOLS })
  }

  if (method === 'tools/call') {
    const name = String(params.name ?? '').trim()
    const args = (params.arguments ?? {}) as Record<string, unknown>
    try {
      if (name === 'scrape_url') {
        const content = await scrapeUrlTool(args, config)
        return ok(body.id, { content: [{ type: 'text', text: JSON.stringify(content, null, 2) }] })
      }
      if (name === 'extract_task') {
        const content = await extractTaskTool(args, config)
        return ok(body.id, {
          content: [{ type: 'text', text: JSON.stringify(content, null, 2).slice(0, 120_000) }],
        })
      }
      return err(body.id, -32601, `unknown tool: ${name}`)
    } catch (e: any) {
      return err(body.id, -32000, String(e?.message ?? e ?? 'tool failed'))
    }
  }

  if (method === 'ping') return ok(body.id, {})
  return err(body.id, -32601, `unknown method: ${method}`)
}
