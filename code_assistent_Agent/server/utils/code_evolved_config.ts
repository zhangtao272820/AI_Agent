/**
 * P4 已晋级提示：影子补丁 hits 达阈值后写入稳定配置。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type CodeEvolvedHint = {
  id: string
  stage: 'compute' | 'agent'
  text: string
  scope: string
  sourcePatchId?: string
  promotedAt: string
}

type EvolvedStore = { hints: CodeEvolvedHint[] }

const STAGE_SCOPE: Record<CodeEvolvedHint['stage'], string> = {
  compute: '总管协作 compute',
  agent: '仓库分析/改码 agent',
}

function evolvedFile() {
  const dir = join(process.cwd(), '.data')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'code-evolved-hints.json')
}

function loadStore(): EvolvedStore {
  const p = evolvedFile()
  if (!existsSync(p)) return { hints: [] }
  try {
    const o = JSON.parse(readFileSync(p, 'utf8')) as EvolvedStore
    return { hints: Array.isArray(o?.hints) ? o.hints : [] }
  } catch {
    return { hints: [] }
  }
}

function saveStore(store: EvolvedStore) {
  writeFileSync(evolvedFile(), JSON.stringify(store, null, 2), 'utf8')
}

export function listEvolvedHints(stage?: CodeEvolvedHint['stage']) {
  const hints = loadStore().hints
  if (!stage) return hints
  return hints.filter((h) => h.stage === stage)
}

export function appendEvolvedHint(input: {
  id: string
  stage: CodeEvolvedHint['stage']
  text: string
  sourcePatchId?: string
}) {
  const store = loadStore()
  const text = String(input.text ?? '').trim().slice(0, 200)
  if (!text) return
  const dup = store.hints.find((h) => h.stage === input.stage && h.text === text)
  if (dup) {
    dup.promotedAt = new Date().toISOString()
    dup.sourcePatchId = input.sourcePatchId ?? dup.sourcePatchId
    saveStore(store)
    return dup.id
  }
  store.hints.push({
    id: input.id,
    stage: input.stage,
    text,
    scope: STAGE_SCOPE[input.stage],
    sourcePatchId: input.sourcePatchId,
    promotedAt: new Date().toISOString(),
  })
  saveStore({ hints: store.hints.slice(-24) })
  return input.id
}

export function clearEvolvedHints() {
  saveStore({ hints: [] })
}
