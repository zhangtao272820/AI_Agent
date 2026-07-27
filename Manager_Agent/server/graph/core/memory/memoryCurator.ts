import fs from 'node:fs/promises'
import path from 'node:path'
import { readManagerMemoryEntries } from '#agent-shared/managerMemoryHistory'
import { resolveStorageBackend, shouldWriteFile } from '#agent-shared/storageBackend'
import { maybeCurateLayeredMemory } from '../layeredMemory'

export function isMemoryCuratorEnabled() {
  const v = String(process.env.MANAGER_MEMORY_CURATE ?? '1').trim().toLowerCase()
  return !(v === '0' || v === 'false' || v === 'off' || v === 'no')
}

function curateIntervalMs() {
  const n = Number(process.env.MANAGER_MEMORY_CURATE_INTERVAL_MS ?? 600_000)
  return Number.isFinite(n) && n >= 60_000 ? Math.min(86_400_000, Math.floor(n)) : 600_000
}

function dedupeKey(e: any) {
  const sk = String(e?.scenarioKey || '').trim().slice(0, 64)
  const intent = String(e?.intent || '').trim()
  const u = String(e?.user || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 96)
  return `${sk}|${intent}|${u}`
}

/**
 * 经验去重 + 低质量样本隔离；控制 jsonl 体积，减轻路由回放带偏。
 * 默认每 10 分钟最多执行一次（可配 MANAGER_MEMORY_CURATE_INTERVAL_MS）；`force` 跳过间隔（供运维接口调用）。
 */
export async function maybeCurateManagerMemory(
  dir: string,
  opts?: { force?: boolean }
): Promise<{ ran: boolean; kept?: number; removed?: number }> {
  if (!isMemoryCuratorEnabled() && !opts?.force) return { ran: false }
  const statePath = path.join(dir, '.memory-curate-state.json')
  if (!opts?.force) {
    try {
      const raw = await fs.readFile(statePath, 'utf8').catch(() => '')
      if (raw.trim()) {
        const j = JSON.parse(raw)
        const last = Number(j?.lastAtMs ?? 0)
        if (Number.isFinite(last) && Date.now() - last < curateIntervalMs()) return { ran: false }
      }
    } catch {}
  }

  const history = await readManagerMemoryEntries(dir, { maxLines: 2500 })
  if (history.length < 40) {
    await fs.writeFile(statePath, JSON.stringify({ lastAtMs: Date.now(), skipped: 'small' }, null, 2), 'utf8').catch(() => undefined)
    return { ran: false }
  }

  const experiences = history.filter((h) => h?.type === 'experience')
  if (experiences.length < 20) {
    await fs.writeFile(statePath, JSON.stringify({ lastAtMs: Date.now(), skipped: 'few_experience' }, null, 2), 'utf8').catch(() => undefined)
    return { ran: false }
  }

  /** 同 key 保留 successScore 更高的一条 */
  const best = new Map<string, any>()
  for (const e of experiences) {
    const k = dedupeKey(e)
    const sc = typeof e?.successScore === 'number' && Number.isFinite(e.successScore) ? e.successScore : 0.55
    const prev = best.get(k)
    if (!prev || sc > (typeof prev?.successScore === 'number' ? prev.successScore : 0)) best.set(k, e)
  }
  const keptExp = Array.from(best.values()).slice(-180)

  const quarantine: any[] = []
  for (const e of experiences) {
    const k = dedupeKey(e)
    const winner = best.get(k)
    if (winner === e) continue
    const sc = typeof e?.successScore === 'number' ? e.successScore : 0
    const fb = typeof e?.feedbackScore === 'number' ? e.feedbackScore : null
    if (sc < 0.42 || fb === 0)
      quarantine.push({ ...e, quarantineReason: sc < 0.42 ? 'low_success_dup' : 'negative_feedback_dup' })
  }

  const others = history.filter((h) => h?.type !== 'experience')
  const nextLines: string[] = []
  for (const h of others) {
    try {
      nextLines.push(JSON.stringify(h))
    } catch {}
  }
  for (const h of keptExp) {
    try {
      nextLines.push(JSON.stringify(h))
    } catch {}
  }

  const removed = experiences.length - keptExp.length
  const jsonlPath = path.join(dir, 'manager-memory.jsonl')
  if (removed > 0 && shouldWriteFile(resolveStorageBackend(process.env.MANAGER_STORAGE_BACKEND, 'file'))) {
    await fs.writeFile(jsonlPath, nextLines.length ? `${nextLines.join('\n')}\n` : '', 'utf8')
  }

  if (quarantine.length) {
    const qPath = path.join(dir, 'manager-memory-quarantine.jsonl')
    const chunk = quarantine.map((x) => JSON.stringify({ ts: new Date().toISOString(), ...x })).join('\n')
    await fs.appendFile(qPath, `${chunk}\n`, 'utf8').catch(() => undefined)
  }

  if (removed === 0 && !quarantine.length) {
    const layered = await maybeCurateLayeredMemory(dir, { force: opts?.force }).catch(() => ({ ran: false }))
    if (layered.ran) {
      await fs.writeFile(statePath, JSON.stringify({ lastAtMs: Date.now(), layered }, null, 2), 'utf8').catch(() => undefined)
      return { ran: true }
    }
    await fs.writeFile(statePath, JSON.stringify({ lastAtMs: Date.now(), skipped: 'noop' }, null, 2), 'utf8').catch(() => undefined)
    return { ran: false }
  }

  await fs.writeFile(statePath, JSON.stringify({ lastAtMs: Date.now(), kept: keptExp.length, removed }, null, 2), 'utf8').catch(() => undefined)
  await maybeCurateLayeredMemory(dir, { force: opts?.force }).catch(() => ({ ran: false }))
  return { ran: true, kept: keptExp.length, removed }
}
