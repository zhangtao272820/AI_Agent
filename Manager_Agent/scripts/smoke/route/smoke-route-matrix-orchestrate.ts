/**
 * 路由矩阵 · 真实编排 LLM（Plan-and-Execute 流水线）
 *
 * 需要 OPENAI_API_KEY（读取 Manager_Agent/.env 若存在）：
 *   cd Manager_Agent
 *   npx tsx scripts/smoke-route-matrix-orchestrate.ts
 *
 * 只跑部分用例：
 *   npx tsx scripts/smoke-route-matrix-orchestrate.ts rag_db_dual db_only_age_chart
 *
 * 可选 probe 注入（Docker agents-lan）：
 *   MANAGER_SMOKE_PROBE=1 DB_AGENT_HTTP_URL=http://127.0.0.1:13101 RAG_AGENT_HTTP_URL=http://127.0.0.1:13102 npx tsx scripts/smoke-route-matrix-orchestrate.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { HumanMessage } from '@langchain/core/messages'
import { SystemMessage } from '@langchain/core/messages'
import { ChatOpenAI } from '@langchain/openai'
import { resolveOrchestratorPipeline } from '../../../server/graph/orchestrate/orchestratorPipeline'
import { resolveTaskOrchestrationByLlm } from '../../../server/graph/llm/taskOrchestrator'
import { resolveTurnRoutingScope } from '../../../server/graph/core/routing/turnScope'
import type { LlmInvokeFn } from '../../../server/graph/llm/taskConstraintsLlm'
import {
  ROUTE_MATRIX_CASES,
  evaluateRouteMatrixCase,
  type RouteMatrixCase
} from './route-matrix-cases'

const __dir = path.dirname(fileURLToPath(import.meta.url))

function loadEnvFile(rel: string) {
  const p = path.join(__dir, rel)
  if (!fs.existsSync(p)) return
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i <= 0) continue
    const k = t.slice(0, i).trim()
    let v = t.slice(i + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    if (!process.env[k]) process.env[k] = v
  }
}

loadEnvFile('../.env')

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

async function probeRag(base: string, query: string) {
  const r = await fetch(`${base.replace(/\/+$/, '')}/api/probe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-manager-orchestrated': '1' },
    body: JSON.stringify({ query, k: 5 })
  })
  return r.json() as Promise<{ hits?: number; sources?: string[] }>
}

async function probeDb(base: string, question: string) {
  const r = await fetch(`${base.replace(/\/+$/, '')}/api/probe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, dbId: 'default' })
  })
  return r.json() as Promise<{ matched?: boolean; tables?: string[] }>
}

function createSmokeLlmInvoke(): LlmInvokeFn {
  const apiKey = String(process.env.OPENAI_API_KEY ?? '').trim()
  if (!apiKey) {
    throw new Error('缺少 OPENAI_API_KEY：请在 Manager_Agent/.env 配置，或导出环境变量后再运行')
  }
  const modelName = String(
    process.env.MANAGER_MODEL_ROUTE ?? process.env.OPENAI_MODEL ?? 'qwen-plus-2025-01-25'
  ).trim()
  const baseUrl = String(process.env.OPENAI_BASE_URL ?? '').trim() || undefined
  const qwenHybrid = /^qwen3/i.test(modelName)
  const chat = new ChatOpenAI({
    apiKey,
    model: modelName,
    configuration: baseUrl ? { baseURL: baseUrl } : undefined,
    temperature: 0,
    maxTokens: 4096,
    ...(qwenHybrid ? { modelKwargs: { enable_thinking: false } } : {})
  })

  return async (_stage, _state, messages) => {
    const lc = messages.map((m: unknown) => {
      const pair = m as [string, string]
      const role = String(pair[0] ?? 'human')
      const content = String(pair[1] ?? '')
      return role === 'system' ? new SystemMessage(content) : new HumanMessage(content)
    })
    const resp = await chat.invoke(lc)
    return { text: String(resp.content ?? '') }
  }
}

const filterIds = process.argv.slice(2).filter((a) => !a.startsWith('-'))
let cases: RouteMatrixCase[] = ROUTE_MATRIX_CASES
if (filterIds.length) {
  cases = ROUTE_MATRIX_CASES.filter((c) => filterIds.some((f) => c.id.includes(f) || c.label.includes(f)))
  assert(cases.length, `未匹配用例：${filterIds.join(', ')}`)
}

const llmInvoke = createSmokeLlmInvoke()
const withProbe = String(process.env.MANAGER_SMOKE_PROBE ?? '').trim() === '1'
const ragBase = String(process.env.RAG_AGENT_HTTP_URL ?? 'http://127.0.0.1:13102')
const dbBase = String(process.env.DB_AGENT_HTTP_URL ?? 'http://127.0.0.1:13101')

console.log('=== 路由矩阵 · 编排 LLM 联机 ===\n')
console.log(`用例数: ${cases.length} | probe注入: ${withProbe ? '是' : '否'}\n`)

let passed = 0
let failed = 0

for (const c of cases) {
  let probe: { db?: { matched?: boolean; tables?: string[] }; rag?: { hits?: number } } | null = null
  if (withProbe) {
    probe = {}
    if (c.ragProbe) {
      const rag = await probeRag(ragBase, c.ragProbe)
      probe.rag = { hits: Number(rag.hits ?? 0) }
    }
    if (c.dbProbe) {
      const db = await probeDb(dbBase, c.dbProbe)
      probe.db = { matched: db.matched, tables: db.tables }
    }
  }

  const messages = [new HumanMessage(c.userTask)]
  const turnScope = resolveTurnRoutingScope({ messages, lastUser: c.userTask })
  const state = {
    messages,
    resources: { budgetUsd: 999, budgetTokens: 999999, usedUsd: 0, usedTokens: 0 },
    meta: { lowCostMode: false }
  }

  let result: Awaited<ReturnType<typeof resolveOrchestratorPipeline>> | null = null
  try {
    result = await resolveOrchestratorPipeline({
      messages,
      lastUser: c.userTask,
      routingContext: c.userTask,
      turnScope,
      probe,
      llmInvoke,
      state,
      seedBundle: null
    })
  } catch (e) {
    const llmOnly = await resolveTaskOrchestrationByLlm({
      messages,
      lastUser: c.userTask,
      routingContext: c.userTask,
      llmInvoke,
      state
    })
    console.log(`FAIL · ${c.id} · ${c.label}`)
    console.log(`  编排 LLM 未产出 bundle: ${e instanceof Error ? e.message : e}`)
    if (llmOnly.failures.length) {
      console.log(`  解析失败: ${llmOnly.failures.map((f) => `${f.stage}:${f.reason}`).join('；')}`)
    }
    console.log('')
    failed++
    continue
  }

  const bpAgents = result.decision.planBlueprint?.steps?.map((s) => String(s.agent)) ?? []
  const evalResult = evaluateRouteMatrixCase(
    [...result.decision.allowedAgents],
    bpAgents,
    c,
    {
      dataSources: result.decision.intentClassify.dataSources,
      planShortcut: result.decision.intentClassify.planShortcut,
      clauses: result.decision.clauses
    }
  )

  const status = evalResult.ok ? 'PASS' : 'FAIL'
  if (evalResult.ok) passed++
  else failed++

  console.log(`${status} · ${c.id} · ${c.label}`)
  console.log(`  问句: ${c.userTask.slice(0, 72)}${c.userTask.length > 72 ? '…' : ''}`)
  console.log(`  来源: ${result.source} | reflex=${result.judgeRetries} | shortcut=${evalResult.planShortcut}`)
  console.log(`  期望 cap: ${c.expectCap.join(' → ')}`)
  console.log(`  实际 cap: ${evalResult.cap.join(' → ')}`)
  console.log(`  数据面: ${evalResult.dataSources.join('+') || '—'}`)
  console.log(`  子句: ${evalResult.clauses || '（无）'}`)
  console.log(`  蓝图: ${evalResult.blueprintAgents.join(' → ') || '（无）'}`)
  if (!evalResult.ok) {
    if (evalResult.missingCap.length) console.log(`  ✗ cap 缺: ${evalResult.missingCap.join(', ')}`)
    if (evalResult.missingPlan.length) console.log(`  ✗ 计划缺: ${evalResult.missingPlan.join(', ')}`)
    if (evalResult.spurious.length) console.log(`  ✗ 越界 agent: ${evalResult.spurious.join(', ')}`)
    if (result.lintIssues.length) console.log(`  lint: ${result.lintIssues.slice(0, 3).join('；')}`)
    if (result.judgeRationale) console.log(`  judge: ${result.judgeRationale.slice(0, 120)}`)
  }
  console.log('')
}

console.log(`\n合计: ${passed} 通过 / ${failed} 失败 / ${cases.length} 用例`)
if (failed > 0) process.exit(1)
console.log('smoke-route-matrix-orchestrate: OK')
