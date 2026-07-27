/**
 * Prompt 影子进化：失败反思 / 负反馈沉淀短补丁，注入 plan/slot/extract 阶段。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getExtractorAgentEnv } from './extractor_agent_env'
import { verifyBeforePromote } from '#agent-shared/evolutionVerify'
import { isAgentEvolutionStageAllowed, isPromoteVerifyRequired } from '#agent-shared/evolutionPromotePolicy'

export type PromptStage = 'plan' | 'slot' | 'extract'

export type PromptPatch = {
  id: string
  ts: string
  stage: PromptStage
  text: string
  source: 'reflection' | 'feedback' | 'empty_result'
  hits: number
  promotedAt?: string
}

type PatchStore = { patches: PromptPatch[] }

function clipText(s: string, max: number) {
  const t = String(s ?? '').trim()
  return t.length > max ? t.slice(0, max) : t
}

function patchFile() {
  const dir = join(process.cwd(), '.data')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'extractor-prompt-patches.shadow.json')
}

function evolvedFile() {
  return join(process.cwd(), '.data', 'extractor-blueprint.evolved.json')
}

function loadStore(): PatchStore {
  if (!getExtractorAgentEnv().enablePromptEvolution) return { patches: [] }
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
  writeFileSync(patchFile(), JSON.stringify({ patches: store.patches.slice(-40) }, null, 2), 'utf8')
}

export function appendPromptPatch(input: {
  stage: PromptStage
  text: string
  source: PromptPatch['source']
}) {
  if (!getExtractorAgentEnv().enablePromptEvolution) return
  if (!isAgentEvolutionStageAllowed('extractor', input.stage)) return
  const t = clipText(input.text, 200)
  if (!t) return
  const store = loadStore()
  const dup = store.patches.find((p) => !p.promotedAt && p.stage === input.stage && p.text === t)
  if (dup) {
    dup.hits += 1
    dup.ts = new Date().toISOString()
  } else {
    store.patches.push({
      id: `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      ts: new Date().toISOString(),
      stage: input.stage,
      text: t,
      source: input.source,
      hits: 1,
    })
  }
  saveStore(store)
}

export function getPromptPatchesForStage(stage: PromptStage, max = 3): string {
  if (!getExtractorAgentEnv().enablePromptEvolution) return ''
  const store = loadStore()
  const evolved = listEvolvedHints(stage)
  const shadow = store.patches
    .filter((p) => !p.promotedAt && p.stage === stage)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, max)
  const lines: string[] = []
  for (const h of evolved.slice(0, 2)) lines.push(`- [已晋级] ${h}`)
  for (const p of shadow) lines.push(`- ${p.text}`)
  if (!lines.length) return ''
  return clipText(`[进化提示·${stage}]\n${lines.join('\n')}`, 480)
}

export function listPromptPatches() {
  return loadStore().patches
}

export function listPromotablePatches(minHits?: number) {
  const min = minHits ?? getExtractorAgentEnv().promptPromoteMinHits
  return loadStore().patches.filter((p) => !p.promotedAt && p.hits >= min)
}

type EvolvedStore = { updatedAt: string; hints: Array<{ id: string; stage: PromptStage; text: string }> }

function loadEvolved(): EvolvedStore {
  if (!existsSync(evolvedFile())) return { updatedAt: '', hints: [] }
  try {
    const o = JSON.parse(readFileSync(evolvedFile(), 'utf8')) as EvolvedStore
    return { updatedAt: o.updatedAt || '', hints: Array.isArray(o.hints) ? o.hints : [] }
  } catch {
    return { updatedAt: '', hints: [] }
  }
}

function listEvolvedHints(stage: PromptStage): string[] {
  return loadEvolved().hints.filter((h) => h.stage === stage).map((h) => h.text)
}

export function promotePromptPatch(patchId: string): { ok: boolean; reason?: string; hintId?: string } {
  const store = loadStore()
  const patch = store.patches.find((p) => p.id === patchId)
  if (!patch) return { ok: false, reason: 'patch_not_found' }
  if (patch.promotedAt) return { ok: false, reason: 'already_promoted' }
  const evolved = loadEvolved()
  const hintId = `evolved_${patch.stage}_${patch.id.slice(-8)}`
  evolved.hints.push({ id: hintId, stage: patch.stage, text: patch.text })
  evolved.updatedAt = new Date().toISOString()
  patch.promotedAt = evolved.updatedAt
  try {
    writeFileSync(evolvedFile(), JSON.stringify(evolved, null, 2), 'utf8')
    saveStore(store)
    return { ok: true, hintId }
  } catch {
    return { ok: false, reason: 'write_failed' }
  }
}

export function autoPromoteEligiblePatches(minHits?: number): string[] {
  if (isPromoteVerifyRequired()) return []
  const promoted: string[] = []
  for (const p of listPromotablePatches(minHits)) {
    const res = promotePromptPatch(p.id)
    if (res.ok) promoted.push(p.id)
  }
  return promoted
}

export async function promotePromptPatchVerified(
  patchId: string
): Promise<{ ok: boolean; reason?: string; hintId?: string }> {
  const verify = await verifyBeforePromote('extractor')
  if (!verify.ok) return { ok: false, reason: `verify_failed:${verify.reason || verify.gate}` }
  return promotePromptPatch(patchId)
}

export async function autoPromoteEligiblePatchesVerified(minHits?: number) {
  const verify = await verifyBeforePromote('extractor')
  if (!verify.ok) return { promoted: [] as string[], verify }
  const promoted: string[] = []
  for (const p of listPromotablePatches(minHits)) {
    const res = promotePromptPatch(p.id)
    if (res.ok) promoted.push(p.id)
  }
  return { promoted, verify }
}

export function clearPromptPatches() {
  saveStore({ patches: [] })
}

export function getPromptEvolutionSummary() {
  const store = loadStore()
  const evolved = loadEvolved()
  return {
    shadowCount: store.patches.filter((p) => !p.promotedAt).length,
    promotableCount: listPromotablePatches().length,
    evolvedCount: evolved.hints.length,
    recent: store.patches.slice(-5).map((p) => ({ stage: p.stage, text: p.text.slice(0, 80), hits: p.hits })),
  }
}
