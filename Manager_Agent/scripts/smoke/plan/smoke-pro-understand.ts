/**
 * P2 PU-Stack 结构回归（离线 + 可选 LLM 联机）
 */
import fs from 'node:fs'
import fsP from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { ChatOpenAI } from '@langchain/openai'
import { shouldSuppressClarifyFromHint } from '../../../server/graph/core/plan/clarifySuppress'
import { dataPlaneRoutingHintFromMeta } from '../../../server/graph/core/routing/dataPlaneRoutingHint'
import { capFloorFromPuStackMeta } from '../../../server/graph/orchestrate/puStackOrchestratorAuthority'
import { mergePuStackIntoOrchestratorBundle } from '../../../server/graph/orchestrate/puStackOrchestratorMerge'
import { buildOrchestratorBundleFromClassify } from '../../../server/graph/llm/taskOrchestrator'
import { resolveManagerInteractionMode } from '../../../server/utils/platform/managerInteractionMode'
import type { LlmInvokeFn } from '../../../server/graph/llm/taskConstraintsLlm'
import { runProfessionalPuStack } from '../../../server/graph/core/proPuStack'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FILE = path.join(__dirname, '../../..', 'eval', 'golden-pro-understand.json')

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

function loadEnvFile(rel: string) {
  const p = path.join(__dirname, rel)
  if (!fs.existsSync(p)) return
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i <= 0) continue
    const k = t.slice(0, i).trim()
    let v = t.slice(i + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!process.env[k]) process.env[k] = v
  }
}

loadEnvFile('../.env')

// 离线：interaction mode + clarify suppress + cap floor mock
assert(resolveManagerInteractionMode({ interactionMode: 'professional' }) === 'professional', 'pro mode meta')
assert(resolveManagerInteractionMode({ workbenchMode: 'chat' }) === 'chat', 'chat mode meta')

const dbHint = dataPlaneRoutingHintFromMeta({
  dataPlaneTaskIntent: 'structured_query',
  dataPlanePrimaryPlane: 'db',
  hasExplicitSubject: true,
  dataPlaneClarifyRisk: 'low',
  dataPlaneConfidence: 0.72
})
assert(dbHint && shouldSuppressClarifyFromHint(dbHint), 'db single-source clarify suppress')

const hybridMeta = {
  taskShape: 'multi_source_parallel',
  requiresAgentPipelineHint: true,
  wantsVisualizeHint: true,
  wantsAdminHint: true,
  inferredDataSources: [
    { plane: 'rag', confidence: 0.8, inferReason: '文档检索' },
    { plane: 'db', confidence: 0.8, inferReason: '结构化取数' },
    { plane: 'admin', confidence: 0.7, inferReason: '路线时长' }
  ],
  stepDispatchDraft: [
    { agent: 'rag', scopedUserLanguage: '查失能老人护理员配比标准', clauseIds: ['c1'] },
    { agent: 'db', scopedUserLanguage: '查王建国的慢性病检测记录', clauseIds: ['c2'] },
    { agent: 'admin', scopedUserLanguage: '坐地铁从天津西站到天津站大概多久', clauseIds: ['c3'] }
  ]
}
const cap = capFloorFromPuStackMeta(hybridMeta, null)
for (const a of ['rag', 'db', 'admin', 'clean', 'code', 'visualize']) {
  assert(cap.includes(a as typeof cap[number]), `E4 cap floor missing ${a}`)
}

const seed = buildOrchestratorBundleFromClassify({
  lastUser: 'hybrid',
  turnScopeMode: 'single_turn',
  classify: {
    isMulti: true,
    isDbAnchored: true,
    needsAdmin: false,
    needsWeb: false,
    dataSources: ['rag', 'db'],
    suggestedAgents: ['rag', 'db'],
    requiresAgentPipeline: true,
    planShortcut: 'none',
    allowChatWebDirect: false,
    primaryIntent: 'multi',
    explicitWantsVisualize: true,
    explicitWantsReport: false,
    confidence: 0.8,
    rationale: 'test'
  }
})
const merged = mergePuStackIntoOrchestratorBundle(seed, hybridMeta)
assert(merged.allowedAgents.includes('admin'), 'merge preserves admin from PU meta')
assert(merged.allowedAgents.includes('visualize'), 'merge adds visualize pipeline')

const spec = JSON.parse(await fsP.readFile(FILE, 'utf8'))
const cases = Array.isArray(spec?.cases) ? spec.cases : []
assert(cases.length > 0, 'no pro-understand cases')

const apiKey = String(process.env.OPENAI_API_KEY ?? '').trim()
const runLlm = apiKey.length > 0 && String(process.env.MANAGER_SMOKE_SKIP_LLM ?? '') !== '1'

if (runLlm) {
  process.env.MANAGER_PRO_MODE = 'strong'
  const modelName = String(process.env.MANAGER_MODEL_ROUTE ?? process.env.OPENAI_MODEL ?? 'qwen-plus-2025-01-25').trim()
  const baseUrl = String(process.env.OPENAI_BASE_URL ?? '').trim() || undefined
  const chat = new ChatOpenAI({
    apiKey,
    model: modelName,
    configuration: baseUrl ? { baseURL: baseUrl } : undefined,
    temperature: 0,
    maxTokens: 2048,
    ...( /^qwen3/i.test(modelName) ? { modelKwargs: { enable_thinking: false } } : {})
  })
  const llmInvoke: LlmInvokeFn = async (_stage, _state, messages) => {
    const lc = messages.map((m: unknown) => {
      const pair = m as [string, string]
      const role = String(pair[0] ?? 'human')
      const content = String(pair[1] ?? '')
      return role === 'system' ? new SystemMessage(content) : new HumanMessage(content)
    })
    const resp = await chat.invoke(lc)
    return { text: String(resp.content ?? '') }
  }
  const state = { messages: [], meta: { interactionMode: 'professional' } }
  for (const c of cases) {
    const pu = await runProfessionalPuStack({
      interactionMode: 'professional',
      lastUser: String(c.user),
      llmInvoke,
      state
    })
    assert(pu, `${c.id}: PU stack null`)
    if (c.expectTaskIntent) {
      assert(pu!.dataPlane?.taskIntent === c.expectTaskIntent, `${c.id}: taskIntent ${pu!.dataPlane?.taskIntent}`)
    }
    if (c.expectPrimaryPlane) {
      assert(pu!.dataPlane?.primaryPlane === c.expectPrimaryPlane, `${c.id}: primaryPlane`)
    }
    if (Array.isArray(c.expectPlanes)) {
      const planes = (pu!.dataPlane?.inferredDataSources ?? []).map((d) => d.plane)
      for (const p of c.expectPlanes) assert(planes.includes(p), `${c.id}: missing plane ${p}`)
    }
    if (c.expectWantsVisualize) assert(pu!.taskShape?.wantsVisualize === true, `${c.id}: wantsVisualize`)
    if (c.expectWantsAdmin) assert(pu!.taskShape?.wantsAdmin === true, `${c.id}: wantsAdmin`)
    console.log(`pro-understand llm ok: ${c.id}`)
  }
} else {
  console.log('pro-understand: skip LLM (no OPENAI_API_KEY or MANAGER_SMOKE_SKIP_LLM=1)')
  for (const c of cases) console.log(`pro-understand structural skip llm: ${c.id}`)
}

console.log('smoke: pro-understand ok')
