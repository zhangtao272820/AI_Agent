import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildCodeAgentRuntimeConfig } from './server/utils/code_agent_env'

function agentSharedDir() {
  const docker = fileURLToPath(new URL('./agent-repo-shared', import.meta.url))
  const local = fileURLToPath(new URL('../shared', import.meta.url))
  if (existsSync(join(docker, 'agentPgClient.ts'))) return docker
  return local
}

const codeRuntime = buildCodeAgentRuntimeConfig()

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: process.env.NODE_ENV !== 'production' },
  alias: {
    '#agent-shared': agentSharedDir()
  },
  modules: ['@pinia/nuxt'],
  vite: {
    optimizeDeps: {
      include: [
        '@vue/devtools-core',
        '@vue/devtools-kit',
        'monaco-editor'
      ]
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
        '@langchain/langgraph',
        '@langchain/openai',
        'openai',
        'typescript',
        'zod'
      ]
    }
  },
  runtimeConfig: codeRuntime
})
