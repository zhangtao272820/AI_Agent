// https://nuxt.com/docs/api/configuration/nuxt-config
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EXTRACTOR_AGENT_DEFAULTS } from './server/utils/extractor_agent_env'
import { resolveExtractorModes } from './server/utils/extractor_modes'

function agentSharedDir() {
  const docker = fileURLToPath(new URL('./agent-repo-shared', import.meta.url))
  const local = fileURLToPath(new URL('../shared', import.meta.url))
  if (existsSync(join(docker, 'qwenModelKwargs.ts'))) return docker
  return local
}

const d = EXTRACTOR_AGENT_DEFAULTS
const modes = resolveExtractorModes()

export default defineNuxtConfig({
  alias: {
    '#agent-shared': agentSharedDir()
  },
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  devServer: {
    port: Number(((globalThis as any).process?.env?.CRAWLER_PORT ?? (globalThis as any).process?.env?.PORT ?? 13104))
  },
  vite: {
    optimizeDeps: {
      include: ['three', '@vue/devtools-core', '@vue/devtools-kit']
    }
  },
  nitro: {
    alias: {
      '#agent-shared': agentSharedDir()
    },
    experimental: {
      websocket: true
    },
    externals: {
      external: [
        '@langchain/core',
        '@langchain/core/prompts',
        '@langchain/core/output_parsers',
        '@langchain/core/runnables',
        '@langchain/langgraph',
        '@langchain/openai',
        'openai',
        'zod',
        'cheerio'
      ]
    }
  },
  runtimeConfig: {
    qwenApiKey: process.env.QWEN_API_KEY,
    qwenBaseUrl: process.env.QWEN_BASE_URL ?? d.qwenBaseUrl,
    qwenModel: process.env.QWEN_MODEL ?? d.qwenModel,
    qwenVlModel: process.env.QWEN_VL_MODEL ?? d.qwenVlModel,
    qwenEnableThinking: /^(1|true|yes)$/i.test(String(process.env.QWEN_ENABLE_THINKING ?? '')),
    extractorMode: modes.extractorMode,
    plannerMode: modes.plannerMode,
    agentMode: modes.agentMode,
    crawler: {
      userAgent:
        process.env.CRAWLER_UA ??
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
    },
    mcp: {
      provider: (process.env.MCP_PROVIDER as any) ?? undefined,
      apiKey: process.env.MCP_API_KEY,
      baseUrl: process.env.MCP_BASE_URL,
      queryParamKey: process.env.MCP_QUERY_PARAM_KEY,
      headerKey: process.env.MCP_HEADER_KEY,
      render: /^(1|true|yes)$/i.test(String(process.env.MCP_RENDER ?? '')),
      country: process.env.MCP_COUNTRY
    },
    public: {
      wsPath: process.env.WS_PATH ?? '/_ws'
    }
  }
})
