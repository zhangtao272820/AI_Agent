/**
 * Code Agent 影子 Prompt 进化：负反馈沉淀短提示，注入 compute/agent 阶段。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getCodeAgentEnv } from './code_agent_env'
import { appendEvolvedHint, listEvolvedHints } from './code_evolved_config'
import type { PromptAbVariant } from './code_prompt_ab_router'
import { verifyBeforePromote } from '#agent-shared/evolutionVerify'
import { isAgentEvolutionStageAllowed, isPromoteVerifyRequired } from '#agent-shared/evolutionPromotePolicy'

export type CodePromptPatch = {
  id: string
  ts: string
  stage: 'compute' | 'agent'
  text: string
  source: 'feedback' | 'validate_fail'
  hits: number
  promotedAt?: string
}

type PatchStore = { patches: CodePromptPatch[] }

function patchFile() {
  const dir = join(process.cwd(), '.data')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'code-prompt-patches.shadow.json')
}

function loadStore(): PatchStore {
  const p = patchFile()
  if (!existsSync(p)) return { patches: [] }
  try {
    const o = JSON.parse(readFileSync(p, 'utf8')) as PatchStore
    return { patches: Array.isArray(o?.patches) ? o.patches : [] }
  } catch {
    return { patches: [] }
  }
}

function saveStore(store: PatchStore) {
  writeFileSync(patchFile(), JSON.stringify({ patches: store.patches.slice(-24) }, null, 2), 'utf8')
}

function promotePatch(store: PatchStore, p: CodePromptPatch): string | null {
  if (p.promotedAt) return null
  appendEvolvedHint({
    id: `ce_${p.id}`,
    stage: p.stage,
    text: p.text,
    sourcePatchId: p.id,
  })
  p.promotedAt = new Date().toISOString()
  return p.id
}

export function appendCodePromptPatch(input: {
  stage: CodePromptPatch['stage']
  text: string
  source: CodePromptPatch['source']
}) {
  if (!getCodeAgentEnv().enablePromptEvolution) return
  if (!isAgentEvolutionStageAllowed('code', input.stage)) return
  const t = String(input.text ?? '').trim().slice(0, 180)
  if (!t) return
  const store = loadStore()
  const dup = store.patches.find((p) => !p.promotedAt && p.stage === input.stage && p.text === t)
  if (dup) {
    dup.hits += 1
    dup.ts = new Date().toISOString()
  } else {
    store.patches.push({
      id: `cp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      ts: new Date().toISOString(),
      stage: input.stage,
      text: t,
      source: input.source,
      hits: 1,
    })
  }
  saveStore(store)
  if (isPromoteVerifyRequired()) {
    void autoPromoteEligiblePatchesVerified().then(() => undefined).catch(() => undefined)
  } else {
    try {
      autoPromoteEligiblePatches()
    } catch {
      /* ignore */
    }
  }
}

export function autoPromoteEligiblePatches(minHits?: number) {
  if (isPromoteVerifyRequired()) return [] as string[]
  const threshold = minHits ?? getCodeAgentEnv().promptEvolveMinHits
  const store = loadStore()
  const promoted: string[] = []
  for (const p of store.patches) {
    if (p.promotedAt || p.hits < threshold) continue
    const id = promotePatch(store, p)
    if (id) promoted.push(id)
  }
  if (promoted.length) saveStore(store)
  return promoted
}

export async function autoPromoteEligiblePatchesVerified(minHits?: number) {
  const verify = await verifyBeforePromote('code')
  if (!verify.ok) return { promoted: [] as string[], verify }
  const threshold = minHits ?? getCodeAgentEnv().promptEvolveMinHits
  const store = loadStore()
  const promoted: string[] = []
  for (const p of store.patches) {
    if (p.promotedAt || p.hits < threshold) continue
    const id = promotePatch(store, p)
    if (id) promoted.push(id)
  }
  if (promoted.length) saveStore(store)
  return { promoted, verify }
}

export function getCodePromptPatchesForStage(
  stage: CodePromptPatch['stage'],
  max = 3,
  abVariant: PromptAbVariant = 'treatment',
): string {
  if (!getCodeAgentEnv().enablePromptEvolution) return ''
  const evolved = abVariant === 'treatment' ? listEvolvedHints(stage) : []
  const shadow = loadStore()
    .patches.filter((p) => !p.promotedAt && p.stage === stage)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, max)
  const lines: string[] = []
  for (const h of evolved.slice(0, 2)) {
    lines.push(`- [已晋级] ${h.text}`)
  }
  for (const p of shadow) {
    lines.push(`- ${p.text}`)
  }
  if (!lines.length) return ''
  return `[进化提示·${stage}]\n${lines.join('\n')}`
}

export function evolveFromNegativeFeedback(question: string, comment?: string) {
  const q = String(question ?? '').trim().slice(0, 120)
  const c = String(comment ?? '').trim().slice(0, 120)
  const text = c || `避免重复失败模式：${q}`
  appendCodePromptPatch({ stage: 'agent', text, source: 'feedback' })
  if (/计算|汇总|整理|推导/.test(q)) {
    appendCodePromptPatch({ stage: 'compute', text, source: 'feedback' })
  }
}

export function evolveFromValidateFail(filesTouched?: string[]) {
  const f = (filesTouched || []).slice(0, 2).join(', ')
  appendCodePromptPatch({
    stage: 'agent',
    text: f ? `修改 ${f} 后须先 validate_project` : '写盘后必须执行 validate_project',
    source: 'validate_fail',
  })
}

export function getPromptEvolutionSummary() {
  const store = loadStore()
  const evolved = listEvolvedHints()
  return {
    patches: store.patches.filter((p) => !p.promotedAt).length,
    promoted: store.patches.filter((p) => p.promotedAt).length,
    evolvedHints: evolved.length,
    byStage: {
      compute: store.patches.filter((p) => p.stage === 'compute' && !p.promotedAt).length,
      agent: store.patches.filter((p) => p.stage === 'agent' && !p.promotedAt).length,
    },
    recent: store.patches
      .filter((p) => !p.promotedAt)
      .slice(-6)
      .map((p) => ({ stage: p.stage, text: p.text.slice(0, 80), hits: p.hits })),
  }
}

export function clearPromptPatches() {
  try {
    writeFileSync(patchFile(), JSON.stringify({ patches: [] }, null, 2), 'utf8')
  } catch {
    /* ignore */
  }
}
